"""stdlib TOTP: RFC 6238 vectors, verification window, replay protection."""
import base64

from app.services import totp

RFC_SECRET = b"12345678901234567890"

# RFC 6238 appendix B, SHA-1 rows: (unix time, expected 8-digit code)
RFC_VECTORS = [
    (59, "94287082"),
    (1111111109, "07081804"),
    (1111111111, "14050471"),
    (1234567890, "89005924"),
    (2000000000, "69279037"),
    (20000000000, "65353130"),
]


def test_rfc6238_sha1_vectors():
    for t, expected in RFC_VECTORS:
        step = t // 30
        assert totp.code_for_step(RFC_SECRET, step, digits=8) == expected


def test_codes_are_six_digits_by_default():
    code = totp.code_for_step(RFC_SECRET, 1)
    assert len(code) == 6
    assert code.isdigit()


def test_verify_accepts_current_step():
    now = 1111111109
    code = totp.code_for_step(RFC_SECRET, now // 30)
    assert totp.verify_code(RFC_SECRET, code, last_accepted_step=None, now=now) == now // 30


def test_verify_accepts_one_step_either_side():
    now = 1111111109
    step = now // 30
    for candidate in (step - 1, step + 1):
        code = totp.code_for_step(RFC_SECRET, candidate)
        assert totp.verify_code(RFC_SECRET, code, last_accepted_step=None, now=now) == candidate


def test_verify_rejects_outside_window():
    now = 1111111109
    step = now // 30
    for candidate in (step - 2, step + 2):
        code = totp.code_for_step(RFC_SECRET, candidate)
        assert totp.verify_code(RFC_SECRET, code, last_accepted_step=None, now=now) is None


def test_verify_rejects_replay_of_accepted_step():
    now = 1111111109
    step = now // 30
    code = totp.code_for_step(RFC_SECRET, step)
    assert totp.verify_code(RFC_SECRET, code, last_accepted_step=None, now=now) == step
    # same code again with the accepted step persisted must fail
    assert totp.verify_code(RFC_SECRET, code, last_accepted_step=step, now=now) is None
    # the previous step is also at or before the accepted one
    prev = totp.code_for_step(RFC_SECRET, step - 1)
    assert totp.verify_code(RFC_SECRET, prev, last_accepted_step=step, now=now) is None
    # the next step is still redeemable
    nxt = totp.code_for_step(RFC_SECRET, step + 1)
    assert totp.verify_code(RFC_SECRET, nxt, last_accepted_step=step, now=now) == step + 1


def test_verify_rejects_malformed_codes():
    now = 1111111109
    assert totp.verify_code(RFC_SECRET, "", None, now=now) is None
    assert totp.verify_code(RFC_SECRET, "12345", None, now=now) is None
    assert totp.verify_code(RFC_SECRET, "abcdef", None, now=now) is None


def test_verify_tolerates_spaces():
    now = 1111111109
    code = totp.code_for_step(RFC_SECRET, now // 30)
    spaced = code[:3] + " " + code[3:]
    assert totp.verify_code(RFC_SECRET, spaced, None, now=now) == now // 30


def test_generate_secret_is_20_bytes():
    assert len(totp.generate_secret()) == 20


def test_base32_roundtrip():
    secret = totp.generate_secret()
    b32 = totp.secret_to_base32(secret)
    assert base64.b32decode(b32 + "=" * (-len(b32) % 8)) == secret


def test_otpauth_uri_shape():
    secret = b"A" * 20
    uri = totp.otpauth_uri(secret, "admin@example.com")
    assert uri.startswith("otpauth://totp/Tracefinity:admin%40example.com?")
    assert f"secret={totp.secret_to_base32(secret)}" in uri
    assert "issuer=Tracefinity" in uri
    assert "algorithm=SHA1" in uri
    assert "digits=6" in uri
    assert "period=30" in uri
