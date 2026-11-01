#!/usr/bin/env python3
"""SQLite smoke test for the Cloudflare D1 migration and critical SQL statements."""
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
DB = sqlite3.connect(':memory:')
DB.row_factory = sqlite3.Row
DB.executescript((ROOT / 'server/migrations/0001_initial.sql').read_text())
NOW = '2026-11-01T12:00:00.000Z'

# License activation + account registration transaction statements.
DB.execute('INSERT INTO licenses(id,code_hash,label,status,max_devices,expires_at,created_at) VALUES(?,?,?,?,?,?,?)',
           ('lic-1', 'license-hash', 'smoke', 'available', 2, None, NOW))
registration = DB.execute('UPDATE licenses SET status=?,activated_family_id=? WHERE id=? AND status=? AND (expires_at IS NULL OR expires_at>?)',
                          ('active', 'fam-1', 'lic-1', 'available', NOW))
assert registration.rowcount == 1
assert DB.execute('INSERT INTO families(id,status,created_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM licenses WHERE id=? AND activated_family_id=? AND status=?)',
                  ('fam-1', 'active', NOW, 'lic-1', 'fam-1', 'active')).rowcount == 1
assert DB.execute('INSERT INTO users(id,family_id,email,password_salt,password_hash,created_at) SELECT ?,id,?,?,?,? FROM families WHERE id=?',
                  ('user-1', 'parent@example.test', 'salt', 'hash', NOW, 'fam-1')).rowcount == 1
DB.execute('INSERT INTO sessions(id,user_id,family_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)',
           ('sess-1', 'user-1', 'fam-1', 'session-hash', '2026-12-01T00:00:00.000Z', NOW))

# Single-use code redemption statements: the insert is conditional on the one-time use marker.
DB.execute('INSERT INTO pair_codes(id,family_id,code_hash,salt,expires_at,created_at) VALUES(?,?,?,?,?,?)',
           ('code-1', 'fam-1', 'code-hash', 'salt', '2026-11-01T12:05:00.000Z', NOW))
redeem_tag = NOW + '#unique-tag'
use = DB.execute('UPDATE pair_codes SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>?',
                 (redeem_tag, 'code-1', NOW))
assert use.rowcount == 1
insert_device = DB.execute('''INSERT INTO devices(id,family_id,device_name,status,public_key,pairing_secret_hash,created_at,updated_at)
  SELECT ?,family_id,?,?,?, ?,?,? FROM pair_codes WHERE id=? AND used_at=?''',
  ('dev-1', 'Child browser', 'pending', 'public-key', 'pair-secret-hash', NOW, NOW, 'code-1', redeem_tag))
assert insert_device.rowcount == 1

# Parent-approved device activation with a license cap, matching the Worker UPDATE.
approve = DB.execute('''UPDATE devices SET status=?,token_hash=?,keybox=?,updated_at=?
  WHERE id=? AND family_id=? AND status=? AND created_at>?
  AND (SELECT COUNT(*) FROM devices WHERE family_id=? AND status=?) <
      (SELECT max_devices FROM licenses WHERE activated_family_id=? AND status=? AND (expires_at IS NULL OR expires_at>?))''',
  ('active', 'device-token-hash', '{"v":1}', NOW, 'dev-1', 'fam-1', 'pending', '2026-10-31T23:55:00.000Z',
   'fam-1', 'active', 'fam-1', 'active', NOW))
assert approve.rowcount == 1

# Device access request + decision.
DB.execute('INSERT INTO access_requests(id,family_id,device_id,domain,status,created_at) VALUES(?,?,?,?,?,?)',
           ('req-1', 'fam-1', 'dev-1', 'example.test', 'pending', NOW))
assert DB.execute('UPDATE access_requests SET status=?,decided_at=? WHERE id=? AND family_id=? AND status=?',
                  ('approved', NOW, 'req-1', 'fam-1', 'pending')).rowcount == 1

# Encrypted policy envelope upsert; only ciphertext metadata is stored in this table.
DB.execute('''INSERT INTO policies(family_id,policy_ciphertext,version,updated_at) VALUES(?,?,1,?)
  ON CONFLICT(family_id) DO UPDATE SET policy_ciphertext=excluded.policy_ciphertext,version=policies.version+1,updated_at=excluded.updated_at''',
  ('fam-1', '{"v":1,"alg":"A256GCM","iv":"iv","ct":"ciphertext"}', NOW))
assert DB.execute('SELECT version FROM policies WHERE family_id=?', ('fam-1',)).fetchone()['version'] == 1

# Atomic UPSERT rate limiter SQL used by the Worker.
rate_sql = '''INSERT INTO rate_limits(rate_key,window_start,hits) VALUES(?,?,1)
  ON CONFLICT(rate_key) DO UPDATE SET
    hits=CASE WHEN excluded.window_start-rate_limits.window_start>=? THEN 1 ELSE rate_limits.hits+1 END,
    window_start=CASE WHEN excluded.window_start-rate_limits.window_start>=? THEN excluded.window_start ELSE rate_limits.window_start END
  RETURNING hits'''
assert DB.execute(rate_sql, ('ip:test', 1000, 300, 300)).fetchone()['hits'] == 1
assert DB.execute(rate_sql, ('ip:test', 1001, 300, 300)).fetchone()['hits'] == 2
assert DB.execute(rate_sql, ('ip:test', 1300, 300, 300)).fetchone()['hits'] == 1

# Revoke clears both live credentials and any not-yet-consumed pairing envelope.
assert DB.execute('UPDATE devices SET status=?,token_hash=NULL,pairing_secret_hash=NULL,keybox=NULL,updated_at=? WHERE id=? AND family_id=? AND status=?',
                  ('revoked', NOW, 'dev-1', 'fam-1', 'active')).rowcount == 1
row = DB.execute('SELECT status,token_hash,pairing_secret_hash,keybox FROM devices WHERE id=?', ('dev-1',)).fetchone()
assert row['status'] == 'revoked' and row['token_hash'] is None and row['pairing_secret_hash'] is None and row['keybox'] is None

print('D1/SQLite schema and critical SQL smoke checks passed.')
