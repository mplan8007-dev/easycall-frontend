import importlib.util
import pathlib
import struct
import tempfile
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('sip_harness', pathlib.Path(__file__).resolve().parents[1] / 'loadtest/sip/run.py')
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


class SipHarnessTests(unittest.TestCase):
    def test_scenarios_parse_and_only_use_fixture_sip_destination(self):
        for media in [False, True]:
            xml = harness.scenario('/tmp/tone.raw', 120000, media)
            ET.fromstring(xml)
            self.assertIn('sip:fixture@[remote_ip]:[remote_port]', xml)
            self.assertEqual('rtp_stream=' in xml, media)

    def test_non_loopback_interface_refuses_execution(self):
        with patch.object(harness.socket, 'if_nameindex', return_value=[(1, 'lo'), (2, 'eth0')]):
            with self.assertRaises(RuntimeError):
                harness.require_isolation()

    def test_packet_sample_pairs_echoes_and_detects_missing_packet(self):
        def frame(src, dst, seq, ssrc):
            ip = bytearray(20)
            ip[0], ip[9] = 0x45, 17
            rtp = struct.pack('!BBHII', 0x80, 0, seq, seq * 160, ssrc) + b'\xff' * 160
            return bytes(12) + b'\x08\x00' + bytes(ip) + struct.pack('!HHHH', src, dst, len(rtp) + 8, 0) + rtp
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'rtp.pcap'
            data = struct.pack('<IHHIIII', 0xa1b2c3d4, 2, 4, 0, 0, 65535, 1)
            for usec, src, dst, seq, ssrc in [(0, 10000, 6000, 1, 11), (100, 6000, 10000, 1, 11), (1000, 10002, 6000, 1, 22), (200000, 10000, 6000, 2, 11)]:
                packet = frame(src, dst, seq, ssrc)
                data += struct.pack('<IIII', 100, usec, len(packet), len(packet)) + packet
            path.write_bytes(data)
            report = harness.read_rtp(path)
            self.assertEqual(report['distinctSentStreams'], 2)
            self.assertEqual(report['eligiblePackets'], 2)
            self.assertEqual(report['missingEchoes'], 1)
            self.assertEqual(report['sampleLossFraction'], .5)
            self.assertLess(report['loopbackRttP95Ms'], 1)


if __name__ == '__main__':
    unittest.main()
