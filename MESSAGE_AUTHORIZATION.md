# 문자 발송과 연락처 배정

문자 앱을 열 때에는 문자 발송 권한과 배정을 확인하되 통화 시작 표시를 남기지 않습니다. 실제 발신을 요청한 뒤 연결 여부가 불확실하면 통화 중일 가능성을 고려해 기존처럼 배정을 보수적으로 유지합니다.

운영 반영 전 격리된 PostgreSQL 환경에서 회귀 테스트를 실행하고 `20261114_message_authorization.sql`을 프런트엔드보다 먼저 적용해야 합니다. DB 함수 없이 새 프런트엔드만 배포하면 문자 앱 열기가 실패합니다. 구버전 프런트엔드는 계속 기존 함수로 동작합니다.

검증: `node --test tests/message-authorization.test.cjs`; 데이터베이스 검증: `tests/import-lifecycle-rollback.sql` (마이그레이션 적용 후 격리된 시험 DB에서만 실행).
