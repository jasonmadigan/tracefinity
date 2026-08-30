"""scheme-prefixed password hashing: native scrypt plus verify-only bcrypt."""
import bcrypt as bcrypt_lib

from app.services.password_hashing import (
    hash_password,
    is_supported_hash,
    needs_rehash,
    verify_password,
)


def test_scrypt_roundtrip():
    stored = hash_password("correct horse battery staple")
    assert stored.startswith("$scrypt$")
    assert verify_password("correct horse battery staple", stored)
    assert not verify_password("wrong password", stored)


def test_hashes_are_salted():
    assert hash_password("same") != hash_password("same")


def test_native_hash_does_not_need_rehash():
    assert not needs_rehash(hash_password("pw"))


def test_bcrypt_verify_only():
    stored = bcrypt_lib.hashpw(b"legacy password", bcrypt_lib.gensalt(rounds=4)).decode()
    assert verify_password("legacy password", stored)
    assert not verify_password("wrong", stored)
    assert needs_rehash(stored)


def test_unknown_scheme_rejected():
    assert not verify_password("pw", "$argon2id$whatever")
    assert not verify_password("pw", "plaintext")
    assert not verify_password("pw", "")


def test_mangled_scrypt_hash_rejected():
    stored = hash_password("pw")
    assert not verify_password("pw", stored[:-4])
    assert not verify_password("pw", "$scrypt$n=bad,r=8,p=1$AAAA$AAAA")


def test_is_supported_hash():
    assert is_supported_hash(hash_password("pw"))
    assert is_supported_hash(bcrypt_lib.hashpw(b"pw", bcrypt_lib.gensalt(rounds=4)).decode())
    assert is_supported_hash("$2y$10$" + "a" * 53)
    assert not is_supported_hash("$argon2id$v=19$whatever")
    assert not is_supported_hash("$scrypt$truncated")
    assert not is_supported_hash("plaintext")
