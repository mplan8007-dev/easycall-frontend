import React, { useState, useEffect } from "react";

// 가상 유권자 샘플 데이터
const initialVoters = [
  { id: 1, name: "김철수", phone: "010-1234-5678", region: "대천1동", age: "50대", tendency: "미분류", notes: "" },
  { id: 2, name: "이영희", phone: "010-2345-6789", region: "대천2동", age: "40대", tendency: "우호", notes: "공약 문자 재발송 요청" },
  { id: 3, name: "박민우", phone: "010-3456-7890", region: "동대동", age: "30대", tendency: "미분류", notes: "" },
  { id: 4, name: "정순자", phone: "010-4567-8901", region: "죽정동", age: "60대", tendency: "부동", notes: "경로당 지원 정책 관심" },
];

export default function EasyCallApp() {
  const [voters, setVoters] = useState(initialVoters);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [callStatus, setCallStatus] = useState("대기중"); // 대기중, 통화중, 후처리중
  const [callTimer, setCallTimer] = useState(0);
  const [autoDial, setAutoDial] = useState(false);
  const [selectedTendency, setSelectedTendency] = useState("미분류");
  const [memo, setMemo] = useState("");
  const [sentSms, setSentSms] = useState(false);

  const currentVoter = voters[currentIndex] || {};

  // 통화 타이머
  useEffect(() => {
    let interval = null;
    if (callStatus === "통화중") {
      interval = setInterval(() => setCallTimer((prev) => prev + 1), 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [callStatus]);

  // 발신 시작
  const handleStartCall = () => {
    setCallStatus("통화중");
    setCallTimer(0);
    setSentSms(false);
    setSelectedTendency(currentVoter.tendency || "미분류");
    setMemo(currentVoter.notes || "");
  };

  // 통화 종료 및 후처리
  const handleEndCall = () => {
    setCallStatus("후처리중");
  };

  // 결과 저장 및 다음 유권자 전환
  const handleSaveAndNext = () => {
    setVoters((prev) =>
      prev.map((v, idx) =>
        idx === currentIndex
          ? { ...v, tendency: selectedTendency, notes: memo }
          : v
      )
    );

    setCallStatus("대기중");
    setCallTimer(0);
    setSentSms(false);

    if (currentIndex < voters.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      if (autoDial) {
        setTimeout(() => handleStartCall(), 1500);
      }
    } else {
      alert("배정된 유권자 명부 통화가 모두 완료되었습니다.");
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "sans-serif", backgroundColor: "#f1f5f9" }}>
      {/* 좌측 패널: 유권자 명부 및 관제 현황 */}
      <div style={{ width: "320px", borderRight: "1px solid #cbd5e1", backgroundColor: "#ffffff", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px", backgroundColor: "#1e293b", color: "#ffffff" }}>
          <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: "bold" }}>이지콜 (EasyCall)</h2>
          <p style={{ margin: "4px 0 0 0", fontSize: "0.8rem", color: "#94a3b8" }}>캠프 통합 PDS 시스템</p>
        </div>

        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0", backgroundColor: "#f8fafc" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: "bold", color: "#475569" }}>진행 현황</span>
            <span style={{ fontSize: "0.85rem", color: "#2563eb", fontWeight: "bold" }}>
              {currentIndex + 1} / {voters.length} 명
            </span>
          </div>
          <div style={{ marginTop: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="checkbox"
              id="autoDial"
              checked={autoDial}
              onChange={(e) => setAutoDial(e.target.checked)}
            />
            <label htmlFor="autoDial" style={{ fontSize: "0.85rem", color: "#334155", cursor: "pointer" }}>
              자동 연속 발신 (Progressive)
            </label>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
          {voters.map((voter, index) => (
            <div
              key={voter.id}
              onClick={() => {
                if (callStatus === "대기중") setCurrentIndex(index);
              }}
              style={{
                padding: "12px",
                borderRadius: "6px",
                marginBottom: "6px",
                cursor: callStatus === "대기중" ? "pointer" : "not-allowed",
                backgroundColor: index === currentIndex ? "#eff6ff" : "#ffffff",
                border: index === currentIndex ? "1px solid #3b82f6" : "1px solid #e2e8f0",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: "bold", color: "#1e293b" }}>{voter.name}</span>
                <span
                  style={{
                    fontSize: "0.75rem",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    backgroundColor:
                      voter.tendency === "우호" ? "#dcfce7" : voter.tendency === "부동" ? "#fef9c3" : "#f1f5f9",
                    color: voter.tendency === "우호" ? "#15803d" : voter.tendency === "부동" ? "#854d0e" : "#64748b",
                  }}
                >
                  {voter.tendency}
                </span>
              </div>
              <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "4px" }}>
                {voter.phone} · {voter.region}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 우측 메인 영역: 발신 화면 & 통화 제어 & 성향 입력 */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {/* 상단 통화 상태 바 */}
        <div style={{ height: "70px", backgroundColor: "#ffffff", borderBottom: "1px solid #cbd5e1", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span
              style={{
                display: "inline-block",
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                backgroundColor: callStatus === "통화중" ? "#22c55e" : callStatus === "후처리중" ? "#eab308" : "#94a3b8",
              }}
            />
            <span style={{ fontWeight: "bold", color: "#1e293b" }}>{callStatus}</span>
            {callStatus === "통화중" && (
              <span style={{ fontSize: "1.1rem", fontWeight: "bold", color: "#ef4444" }}>{formatTime(callTimer)}</span>
            )}
          </div>

          <div>
            {callStatus === "대기중" && (
              <button
                onClick={handleStartCall}
                style={{ backgroundColor: "#2563eb", color: "#ffffff", border: "none", padding: "10px 24px", borderRadius: "6px", fontWeight: "bold", fontSize: "0.95rem", cursor: "pointer" }}
              >
                전화 걸기 (SIP 발신)
              </button>
            )}
            {callStatus === "통화중" && (
              <button
                onClick={handleEndCall}
                style={{ backgroundColor: "#dc2626", color: "#ffffff", border: "none", padding: "10px 24px", borderRadius: "6px", fontWeight: "bold", fontSize: "0.95rem", cursor: "pointer" }}
              >
                통화 종료
              </button>
            )}
            {callStatus === "후처리중" && (
              <button
                onClick={handleSaveAndNext}
                style={{ backgroundColor: "#16a34a", color: "#ffffff", border: "none", padding: "10px 24px", borderRadius: "6px", fontWeight: "bold", fontSize: "0.95rem", cursor: "pointer" }}
              >
                결과 저장 후 다음 유권자
              </button>
            )}
          </div>
        </div>

        {/* 메인 워크스페이스 */}
        <div style={{ flex: 1, padding: "24px", overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          {/* 유권자 상세 정보 및 스크립트 */}
          <div style={{ backgroundColor: "#ffffff", borderRadius: "8px", border: "1px solid #e2e8f0", padding: "20px" }}>
            <h3 style={{ margin: "0 0 16px 0", color: "#1e293b", fontSize: "1.1rem" }}>유권자 프로필</h3>
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "1.4rem", fontWeight: "bold", color: "#0f172a" }}>{currentVoter.name} 선생님</div>
              <div style={{ color: "#2563eb", fontWeight: "bold", marginTop: "4px" }}>{currentVoter.phone}</div>
              <div style={{ color: "#64748b", fontSize: "0.9rem", marginTop: "4px" }}>
                거주지역: {currentVoter.region} | 연령대: {currentVoter.age}
              </div>
            </div>

            <hr style={{ border: "none", borderTop: "1px solid #e2e8f0", margin: "16px 0" }} />

            <h4 style={{ margin: "0 0 8px 0", color: "#334155" }}>지역 맞춤형 통화 스크립트</h4>
            <div style={{ backgroundColor: "#f8fafc", padding: "14px", borderRadius: "6px", fontSize: "0.95rem", lineHeight: "1.6", color: "#1e293b" }}>
              "안녕하십니까, {currentVoter.name} 선생님! {currentVoter.region}의 새로운 도약을 준비하는 기호 1번 캠프 자원봉사자입니다. 
              {currentVoter.region} 맞춤형 생활 인프라 확충 공약과 어르신 복지 지원 정책에 대해 잠시 의견을 여쭙고자 연락드렸습니다."
            </div>

            <div style={{ marginTop: "16px" }}>
              <button
                disabled={sentSms}
                onClick={() => setSentSms(true)}
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: sentSms ? "#94a3b8" : "#f1f5f9",
                  color: sentSms ? "#ffffff" : "#1e293b",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  fontWeight: "bold",
                  cursor: sentSms ? "default" : "pointer",
                }}
              >
                {sentSms ? "✓ 공약 안내 문자 발송 완료" : "📱 통화 중 공약 요약 문자(SMS) 즉시 전송"}
              </button>
            </div>
          </div>

          {/* 지지 성향 판정 및 메모 */}
          <div style={{ backgroundColor: "#ffffff", borderRadius: "8px", border: "1px solid #e2e8f0", padding: "20px", display: "flex", flexDirection: "column" }}>
            <h3 style={{ margin: "0 0 16px 0", color: "#1e293b", fontSize: "1.1rem" }}>성향 판정 및 통화 기록</h3>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", color: "#475569", marginBottom: "8px" }}>
                지지 성향 선택
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                {["우호", "부동", "비우호", "부재중"].map((type) => (
                  <button
                    key={type}
                    onClick={() => setSelectedTendency(type)}
                    style={{
                      padding: "10px",
                      borderRadius: "6px",
                      border: selectedTendency === type ? "2px solid #2563eb" : "1px solid #cbd5e1",
                      backgroundColor: selectedTendency === type ? "#eff6ff" : "#ffffff",
                      fontWeight: selectedTendency === type ? "bold" : "normal",
                      color: selectedTendency === type ? "#1d4ed8" : "#334155",
                      cursor: "pointer",
                    }}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <label style={{ fontSize: "0.85rem", fontWeight: "bold", color: "#475569", marginBottom: "8px" }}>
                상세 통화 메모 (민원 및 요구사항)
              </label>
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="유권자 반응, 주요 관심 공약, 재통화 요청 시간 등을 기재하세요."
                style={{
                  flex: 1,
                  minHeight: "120px",
                  padding: "12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  resize: "none",
                  fontSize: "0.9rem",
                  fontFamily: "inherit",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
