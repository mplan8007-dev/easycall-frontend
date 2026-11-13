"""SIPp endpoints only, in a network namespace with loopback as its only interface.
This is test-tool baseline evidence, NOT an EasyCall SIP integration/PBX certificate.
"""
import collections
import json
import math
import os
import pathlib
import socket
import struct
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / 'results'


def require_isolation():
    interfaces = {name for _, name in socket.if_nameindex()}
    if interfaces != {'lo'}:
        raise RuntimeError('Refusing SIP test: only loopback may exist in this network namespace')


def ulaw(sample):
    sign = 0x80 if sample < 0 else 0
    value = min(abs(sample), 32635) + 132
    exponent = max(0, min(7, value.bit_length() - 8))
    mantissa = (value >> (exponent + 3)) & 15
    return (~(sign | (exponent << 4) | mantissa)) & 255


def scenario(tone, duration_ms, media):
    audio_start = f'<nop><action><exec rtp_stream="{tone},-1,0,PCMU/8000"/></action></nop>' if media else ''
    audio_stop = '<nop><action><exec rtp_stream="pause"/></action></nop>' if media else ''
    return f'''<?xml version="1.0" encoding="ISO-8859-1" ?>
<!DOCTYPE scenario SYSTEM "sipp.dtd">
<scenario name="Isolated virtual endpoint">
<send retrans="500" start_rtd="true"><![CDATA[
INVITE sip:fixture@[remote_ip]:[remote_port] SIP/2.0
Via: SIP/2.0/[transport] [local_ip]:[local_port];branch=[branch]
From: Fixture <sip:fixture@[local_ip]:[local_port]>;tag=[call_number]
To: Receiver <sip:fixture@[remote_ip]:[remote_port]>
Call-ID: [call_id]
CSeq: 1 INVITE
Contact: <sip:fixture@[local_ip]:[local_port]>
Max-Forwards: 5
Content-Type: application/sdp
Content-Length: [len]

v=0
o=fixture 1 1 IN IP4 [local_ip]
s=isolated-test
c=IN IP4 [local_ip]
t=0 0
m=audio [media_port] RTP/AVP 0
a=rtpmap:0 PCMU/8000
a=sendrecv
]]></send>
<recv response="100" optional="true"/>
<recv response="180" optional="true"/>
<recv response="200" rtd="true"/>
<send><![CDATA[
ACK sip:fixture@[remote_ip]:[remote_port] SIP/2.0
Via: SIP/2.0/[transport] [local_ip]:[local_port];branch=[branch]
From: Fixture <sip:fixture@[local_ip]:[local_port]>;tag=[call_number]
To: Receiver <sip:fixture@[remote_ip]:[remote_port]>[peer_tag_param]
Call-ID: [call_id]
CSeq: 1 ACK
Max-Forwards: 5
Content-Length: 0

]]></send>
{audio_start}
<pause milliseconds="{duration_ms}"/>
{audio_stop}
<send retrans="500"><![CDATA[
BYE sip:fixture@[remote_ip]:[remote_port] SIP/2.0
Via: SIP/2.0/[transport] [local_ip]:[local_port];branch=[branch]
From: Fixture <sip:fixture@[local_ip]:[local_port]>;tag=[call_number]
To: Receiver <sip:fixture@[remote_ip]:[remote_port]>[peer_tag_param]
Call-ID: [call_id]
CSeq: 2 BYE
Max-Forwards: 5
Content-Length: 0

]]></send>
<recv response="200"/>
<ResponseTimeRepartition value="10,20,50,100,200,500,1000"/>
</scenario>'''


def read_stats(path):
    if not path.exists():
        return {}
    rows = [line.strip().split(';') for line in path.read_text().splitlines() if line.strip()]
    if len(rows) < 2:
        return {}
    return dict(zip(rows[0], rows[-1]))


def counter(stats, name):
    return int(float(stats.get(name, '0') or '0'))


def read_rtp(path):
    sent, echoed, streams = {}, {}, collections.Counter()
    end_time = 0.0
    if not path.exists() or path.stat().st_size < 24:
        return {'passed': False, 'reason': 'No RTP capture'}
    with path.open('rb') as source:
        header = source.read(24)
        endian = '<' if header[:4] == b'\xd4\xc3\xb2\xa1' else '>'
        linktype = struct.unpack(endian + 'I', header[20:24])[0]
        if linktype != 1:
            return {'passed': False, 'reason': f'Unexpected pcap linktype {linktype}'}
        while True:
            record = source.read(16)
            if not record:
                break
            sec, usec, length, _ = struct.unpack(endian + 'IIII', record)
            packet = source.read(length)
            if len(packet) < 54 or packet[12:14] != b'\x08\x00':
                continue
            ip = packet[14:]
            if ip[9] != 17:
                continue
            offset = (ip[0] & 15) * 4
            udp = ip[offset:]
            if len(udp) < 20:
                continue
            src, dst = struct.unpack('!HH', udp[:4])
            rtp = udp[8:]
            if rtp[0] >> 6 != 2 or (rtp[1] & 127) != 0:
                continue
            seq, stamp, ssrc = struct.unpack('!HII', rtp[2:12])
            when = sec + usec / 1e6
            end_time = max(end_time, when)
            key = (ssrc, seq, stamp)
            if dst == 6000:
                sent[key] = when
                streams[ssrc] += 1
            elif src == 6000:
                echoed[key] = when
    eligible = {key: when for key, when in sent.items() if when < end_time - .05}
    delays = sorted((echoed[key] - when) * 1000 for key, when in eligible.items() if key in echoed and echoed[key] >= when)
    missing = sum(key not in echoed for key in eligible)
    return {'sampleOnly': True, 'sentPackets': len(sent), 'eligiblePackets': len(eligible),
            'echoedPackets': len(echoed), 'distinctSentStreams': len(streams),
            'distinctEchoedStreams': len({key[0] for key in echoed}), 'missingEchoes': missing,
            'sampleLossFraction': missing / max(1, len(eligible)),
            'loopbackRttP95Ms': delays[min(len(delays) - 1, int(len(delays) * .95))] if delays else None}


def phase(name, devices, hold_seconds, ramp_seconds, media):
    work = OUT / name
    work.mkdir(parents=True, exist_ok=True)
    xml = work / 'uac.xml'
    xml.write_text(scenario(ROOT / 'tone.raw', hold_seconds * 1000, media))
    common = ['-i', '127.0.0.1', '-mi', '127.0.0.1', '-nostdin', '-trace_stat', '-fd', '1', '-trace_err', '-trace_screen']
    server_cmd = ['sipp', '-sn', 'uas', '-p', '5060', '-min_rtp_port', '6000', '-m', str(devices), '-stf', 'server.csv'] + common
    if media:
        server_cmd += ['-rtp_echo']
    client_cmd = ['sipp', '127.0.0.1:5060', '-sf', str(xml), '-p', '5062', '-min_rtp_port', '10000', '-max_rtp_port', '30000',
                  '-r', str(devices / ramp_seconds), '-rp', '1000', '-l', str(devices), '-m', str(devices),
                  '-stf', 'client.csv', '-timeout', str(hold_seconds + ramp_seconds + 45), '-timeout_error'] + common
    result = {'name': name, 'devices': devices, 'holdSecondsPerCall': hold_seconds, 'media': media,
              'environment': 'loopback-only-SIPp-endpoints', 'easycallIntegrationCertified': False}
    server = client = capture = None
    start = time.monotonic()
    with (work / 'server.log').open('w') as server_log, (work / 'client.log').open('w') as client_log, (work / 'capture.log').open('w') as capture_log:
        try:
            server = subprocess.Popen(server_cmd, cwd=work, stdout=server_log, stderr=subprocess.STDOUT)
            time.sleep(.5)
            client = subprocess.Popen(client_cmd, cwd=work, stdout=client_log, stderr=subprocess.STDOUT)
            captured = False
            while client.poll() is None:
                elapsed = time.monotonic() - start
                if media and not captured and elapsed > ramp_seconds + 3:
                    capture = subprocess.Popen(['tcpdump', '-i', 'lo', '-nn', '-s', '256', '-U', '-w', str(work / 'rtp.pcap'), '-c', '1000000', 'udp port 6000'], stdout=capture_log, stderr=subprocess.STDOUT)
                    captured = True
                if capture and capture.poll() is None and elapsed > ramp_seconds + 18:
                    capture.send_signal(2)
                    capture.wait(timeout=5)
                if elapsed > hold_seconds + ramp_seconds + 55:
                    raise TimeoutError('SIP phase exceeded deadline')
                time.sleep(.5)
            result['clientExit'] = client.returncode
            try:
                result['serverExit'] = server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                result['serverExit'] = None
            stats = read_stats(work / 'client.csv')
            rows = (work / 'client.csv').read_text().splitlines() if (work / 'client.csv').exists() else []
            headers = rows[0].split(';') if rows else []
            samples = [dict(zip(headers, line.split(';'))) for line in rows[1:] if line]
            result['successfulCalls'] = counter(stats, 'SuccessfulCall(C)')
            result['failedCalls'] = counter(stats, 'FailedCall(C)')
            result['peakConcurrentCalls'] = max((counter(row, 'CurrentCall') for row in samples), default=0)
            result['finalStats'] = stats
            if media:
                if capture and capture.poll() is None:
                    capture.send_signal(2)
                    capture.wait(timeout=5)
                result['rtpSample'] = read_rtp(work / 'rtp.pcap')
            result['passed'] = (result['clientExit'] == 0 and result['successfulCalls'] == devices and result['failedCalls'] == 0 and result['peakConcurrentCalls'] == devices)
            if media:
                sample = result['rtpSample']
                result['passed'] = result['passed'] and sample.get('eligiblePackets', 0) > 100 and sample.get('distinctSentStreams', 0) >= devices and sample.get('distinctEchoedStreams', 0) >= devices and sample.get('sampleLossFraction', 1) < .01
        except Exception as error:
            result.update(passed=False, error=str(error))
        finally:
            for process in (capture, client, server):
                if process and process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
            pcap = work / 'rtp.pcap'
            if pcap.exists():
                pcap.unlink()  # Keep aggregate evidence, not a large packet capture.
            result['elapsedSeconds'] = round(time.monotonic() - start, 1)
            if not result.get('passed', False):
                server_log.flush()
                client_log.flush()
                result['diagnostics'] = {p.name: p.read_text(errors='replace')[:5000] for p in [work / 'server.log', work / 'client.log']}
            (work / 'result.json').write_text(json.dumps(result, indent=2))
            print(json.dumps(result), flush=True)
    return result


def main():
    require_isolation()
    OUT.mkdir(parents=True, exist_ok=True)
    (ROOT / 'tone.raw').write_bytes(bytes(ulaw(int(5000 * math.sin(2 * math.pi * 440 * i / 8000))) for i in range(8000)))
    results = []
    for args in [('signal-smoke', 20, 3, 2, False), ('signal-2000', 2000, 120, 20, False), ('media-smoke', 20, 12, 2, True), ('media-2000', 2000, 120, 20, True)]:
        result = phase(*args)
        results.append(result)
        if not result['passed']:
            break
    report = {'productionCapacityCertified': False, 'easycallHasNativeSip': False,
              'limitations': ['SIPp endpoints communicate directly; no production PBX or carrier.', 'Loopback RTP sample does not certify Internet voice quality.', 'EasyCall currently launches tel:; no browser SIP/WebRTC integration is exercised.'],
              'passed': len(results) == 4 and all(row['passed'] for row in results), 'phases': results}
    (OUT / 'summary.json').write_text(json.dumps(report, indent=2))
    raise SystemExit(0 if report['passed'] else 1)


if __name__ == '__main__':
    main()
