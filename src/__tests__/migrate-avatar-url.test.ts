/**
 * Unit tests for the avatar URL migration
 * ========================================
 * Verifies the SQL logic defined in:
 *   prisma/migrations/20240105000000_migrate_avatar_url_to_api_uploads/migration.sql
 *
 * The migration rewrites `avatar_url` values in the `settings` table that
 * start with the legacy `/uploads/` prefix to the new `/api/uploads/` prefix
 * used by the dedicated file-serving API route.
 *
 * Because we do not want real database access in unit tests, the migration
 * SQL is not executed directly.  Instead, we reproduce the transformation
 * logic (PostgreSQL REPLACE + LIKE semantics) in TypeScript and test the
 * complete decision matrix against it.  This approach keeps the tests
 * deterministic, fast, and self-contained while giving high confidence that
 * the SQL behaves correctly for every relevant input.
 *
 * Acceptance criteria verified:
 *  1.  `/uploads/<filename>` → `/api/uploads/<filename>` (JPG)
 *  2.  `/uploads/<filename>` → `/api/uploads/<filename>` (PNG)
 *  3.  Records with `avatarUrl = null` are left untouched
 *  4.  Records already using `/api/uploads/` are left untouched (idempotent)
 *  5.  Records with unrelated URLs (e.g. external https://) are left untouched
 *  6.  Records with an empty-string `avatarUrl` are left untouched
 *  7.  The migration is idempotent — running it twice produces the same result
 *  8.  Only the `/uploads/` prefix is replaced; the rest of the path is preserved
 *  9.  Filenames with complex timestamps and hex suffixes are handled correctly
 * 10.  The SQL file exists at the expected path and contains the required SQL
 * 11.  The REPLACE call is scoped to rows matching LIKE '/uploads/%' only
 * 12.  Multiple rows are each migrated independently (no cross-row contamination)
 */

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Pure TypeScript reimplementation of the migration SQL logic
// ---------------------------------------------------------------------------
//
// PostgreSQL semantics faithfully reproduced:
//
//   UPDATE "settings"
//   SET    "avatar_url" = REPLACE("avatar_url", '/uploads/', '/api/uploads/')
//   WHERE  "avatar_url" LIKE '/uploads/%';
//
// The LIKE pattern `/uploads/%` matches any non-null string that starts with
// the literal text `/uploads/`.  NULL values do not match (SQL three-valued
// logic) and are therefore unaffected.

/**
 * Returns true if the given `avatarUrl` would be matched by the WHERE clause
 * `"avatar_url" LIKE '/uploads/%'`.
 *
 * In PostgreSQL, LIKE with a non-null pattern against a NULL value evaluates
 * to UNKNOWN (not TRUE), so NULLs are excluded from the UPDATE.
 */
function matchesWhere(avatarUrl: string | null): boolean {
  if (avatarUrl === null) return false;
  return avatarUrl.startsWith('/uploads/');
}

/**
 * Simulates the full UPDATE statement for a single `avatar_url` value.
 * Returns the value after the migration would have been applied.
 *
 * PostgreSQL REPLACE(str, from, to) replaces ALL non-overlapping occurrences
 * of `from` in `str` with `to`.  The WHERE clause ensures we only call
 * REPLACE on rows that begin with `/uploads/`, so in practice only the
 * leading occurrence is ever relevant.
 */
function applyMigration(avatarUrl: string | null): string | null {
  if (!matchesWhere(avatarUrl)) {
    // Row is excluded by the WHERE clause — value is unchanged.
    return avatarUrl;
  }
  // REPLACE('/uploads/<rest>', '/uploads/', '/api/uploads/') → '/api/uploads/<rest>'
  return (avatarUrl as string).replace('/uploads/', '/api/uploads/');
}

/**
 * Simulates running the migration twice on the same value (idempotency check).
 */
function applyMigrationTwice(avatarUrl: string | null): string | null {
  return applyMigration(applyMigration(avatarUrl));
}

// ---------------------------------------------------------------------------
// Path to the migration SQL file (for content-verification tests)
// ---------------------------------------------------------------------------

const MIGRATION_FILE = path.join(
  process.cwd(),
  'prisma',
  'migrations',
  '20240105000000_migrate_avatar_url_to_api_uploads',
  'migration.sql'
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Avatar URL migration SQL logic', () => {
  // =========================================================================
  // 1 & 2. Core transformation — /uploads/ → /api/uploads/
  // =========================================================================

  describe('Rewrites legacy /uploads/ prefix to /api/uploads/', () => {
    it('migrates a JPG avatar stored with the old /uploads/ prefix', () => {
      const before = '/uploads/1717000000000-a3f9c2.jpg';
      const after = applyMigration(before);
      expect(after).toBe('/api/uploads/1717000000000-a3f9c2.jpg');
    });

    it('migrates a PNG avatar stored with the old /uploads/ prefix', () => {
      const before = '/uploads/1717000000000-b7d4e1.png';
      const after = applyMigration(before);
      expect(after).toBe('/api/uploads/1717000000000-b7d4e1.png');
    });

    it('migrates a JPEG avatar stored with the old /uploads/ prefix', () => {
      const before = '/uploads/1700000000000-ffffff.jpeg';
      const after = applyMigration(before);
      expect(after).toBe('/api/uploads/1700000000000-ffffff.jpeg');
    });

    it('the filename portion after the prefix is preserved exactly', () => {
      const filename = '1700000000000-abc123.jpg';
      const before = `/uploads/${filename}`;
      const after = applyMigration(before);
      expect(after).toBe(`/api/uploads/${filename}`);
      // filename itself is unchanged
      expect(after!.endsWith(filename)).toBe(true);
    });

    it('the result always starts with /api/uploads/ after migration', () => {
      const before = '/uploads/some-file.png';
      const after = applyMigration(before);
      expect(after!.startsWith('/api/uploads/')).toBe(true);
    });

    it('the result never starts with /uploads/ after migration', () => {
      const before = '/uploads/some-file.jpg';
      const after = applyMigration(before);
      expect(after!.startsWith('/uploads/')).toBe(false);
    });
  });

  // =========================================================================
  // 3. NULL values are unaffected
  // =========================================================================

  describe('NULL avatarUrl values are unaffected', () => {
    it('returns null unchanged when avatarUrl is null', () => {
      expect(applyMigration(null)).toBeNull();
    });

    it('matchesWhere returns false for null (SQL UNKNOWN → row excluded)', () => {
      expect(matchesWhere(null)).toBe(false);
    });

    it('running the migration twice on null still returns null', () => {
      expect(applyMigrationTwice(null)).toBeNull();
    });
  });

  // =========================================================================
  // 4. Idempotency — /api/uploads/ values are unchanged on second run
  // =========================================================================

  describe('Idempotency — already-migrated values are untouched', () => {
    it('a value already starting with /api/uploads/ is not modified', () => {
      const alreadyMigrated = '/api/uploads/1717000000000-a3f9c2.jpg';
      expect(applyMigration(alreadyMigrated)).toBe(alreadyMigrated);
    });

    it('matchesWhere returns false for /api/uploads/ values (excluded by WHERE)', () => {
      expect(matchesWhere('/api/uploads/avatar.png')).toBe(false);
    });

    it('running the migration twice on a legacy URL gives the same result as once', () => {
      const before = '/uploads/1700000000000-abc123.jpg';
      const once = applyMigration(before);
      const twice = applyMigrationTwice(before);
      expect(twice).toBe(once);
    });

    it('running the migration twice on a JPG does not double-prefix the URL', () => {
      const before = '/uploads/photo.jpg';
      const twice = applyMigrationTwice(before);
      expect(twice).toBe('/api/uploads/photo.jpg');
      expect(twice).not.toContain('/api/uploads/api/uploads/');
    });

    it('running the migration twice on a PNG does not double-prefix the URL', () => {
      const before = '/uploads/avatar.png';
      const twice = applyMigrationTwice(before);
      expect(twice).toBe('/api/uploads/avatar.png');
      expect(twice).not.toContain('/api/uploads/api/uploads/');
    });

    it('running on null twice still returns null', () => {
      expect(applyMigrationTwice(null)).toBeNull();
    });
  });

  // =========================================================================
  // 5. Unrelated URLs are left untouched
  // =========================================================================

  describe('Unrelated avatarUrl values are left untouched', () => {
    it('an external https:// URL is not modified', () => {
      const external = 'https://cdn.example.com/avatar.jpg';
      expect(applyMigration(external)).toBe(external);
    });

    it('an http:// URL is not modified', () => {
      const external = 'http://example.com/uploads/avatar.png';
      expect(applyMigration(external)).toBe(external);
    });

    it('a path that contains /uploads/ in the middle (not at start) is not modified', () => {
      const mid = '/other/uploads/avatar.jpg';
      expect(applyMigration(mid)).toBe(mid);
    });

    it('matchesWhere returns false for a URL not starting with /uploads/', () => {
      expect(matchesWhere('https://cdn.example.com/avatar.jpg')).toBe(false);
      expect(matchesWhere('/other/uploads/avatar.jpg')).toBe(false);
      expect(matchesWhere('/api/uploads/avatar.jpg')).toBe(false);
    });
  });

  // =========================================================================
  // 6. Empty string is left untouched
  // =========================================================================

  describe('Empty-string avatarUrl values are left untouched', () => {
    it('returns an empty string unchanged', () => {
      expect(applyMigration('')).toBe('');
    });

    it('matchesWhere returns false for an empty string', () => {
      expect(matchesWhere('')).toBe(false);
    });
  });

  // =========================================================================
  // 8 & 9. Path preservation and complex filenames
  // =========================================================================

  describe('Filename is preserved exactly — only the prefix is replaced', () => {
    it('preserves a timestamp-hex filename exactly (JPG)', () => {
      const input = '/uploads/1717000000000-a3f9c2.jpg';
      const output = applyMigration(input);
      expect(output).toBe('/api/uploads/1717000000000-a3f9c2.jpg');
    });

    it('preserves a timestamp-hex filename exactly (PNG)', () => {
      const input = '/uploads/1717000000000-b7d4e1.png';
      const output = applyMigration(input);
      expect(output).toBe('/api/uploads/1717000000000-b7d4e1.png');
    });

    it('the length difference between before and after equals the extra /api segment', () => {
      const before = '/uploads/photo.jpg';
      const after = applyMigration(before)!;
      // '/api/uploads/' is 4 characters longer than '/uploads/'
      expect(after.length - before.length).toBe('/api'.length);
    });

    it('every character after the prefix boundary is identical before and after', () => {
      const filename = '1700000000000-deadbeef.jpeg';
      const before = `/uploads/${filename}`;
      const after = applyMigration(before)!;
      expect(after).toBe(`/api/uploads/${filename}`);
    });
  });

  // =========================================================================
  // 11. WHERE clause selectivity — only `/uploads/%` rows are touched
  // =========================================================================

  describe('WHERE clause correctly targets only /uploads/ rows', () => {
    const cases: Array<[string | null, boolean]> = [
      ['/uploads/avatar.jpg', true],
      ['/uploads/avatar.png', true],
      ['/uploads/1700000000000-abc123.jpg', true],
      ['/api/uploads/avatar.jpg', false],
      ['https://cdn.example.com/avatar.jpg', false],
      ['/other/path/image.jpg', false],
      ['', false],
      [null, false],
    ];

    it.each(cases)(
      'matchesWhere(%s) returns %s',
      (avatarUrl, expected) => {
        expect(matchesWhere(avatarUrl)).toBe(expected);
      }
    );
  });

  // =========================================================================
  // 12. Multiple rows — each migrated independently
  // =========================================================================

  describe('Multiple rows are migrated independently (no cross-row contamination)', () => {
    /**
     * Simulates a batch UPDATE across a table of settings rows.
     * Each row is processed independently; one row's result does not influence another's.
     */
    function migrateTable(
      rows: Array<{ id: number; avatarUrl: string | null }>
    ): Array<{ id: number; avatarUrl: string | null }> {
      return rows.map((row) => ({ ...row, avatarUrl: applyMigration(row.avatarUrl) }));
    }

    it('migrates only the rows with legacy /uploads/ prefix, leaving others untouched', () => {
      const table = [
        { id: 1, avatarUrl: '/uploads/user1-avatar.jpg' },   // should migrate
        { id: 2, avatarUrl: '/api/uploads/user2-avatar.png' }, // already migrated
        { id: 3, avatarUrl: null },                            // null — untouched
        { id: 4, avatarUrl: '/uploads/user4-avatar.png' },   // should migrate
        { id: 5, avatarUrl: '' },                              // empty — untouched
        { id: 6, avatarUrl: 'https://cdn.example.com/img.jpg' }, // external — untouched
      ];

      const result = migrateTable(table);

      expect(result[0].avatarUrl).toBe('/api/uploads/user1-avatar.jpg');      // migrated
      expect(result[1].avatarUrl).toBe('/api/uploads/user2-avatar.png');      // unchanged
      expect(result[2].avatarUrl).toBeNull();                                  // unchanged
      expect(result[3].avatarUrl).toBe('/api/uploads/user4-avatar.png');      // migrated
      expect(result[4].avatarUrl).toBe('');                                    // unchanged
      expect(result[5].avatarUrl).toBe('https://cdn.example.com/img.jpg');    // unchanged
    });

    it('a table of all-null avatarUrls is unchanged after migration', () => {
      const table = [
        { id: 1, avatarUrl: null },
        { id: 2, avatarUrl: null },
        { id: 3, avatarUrl: null },
      ];
      const result = migrateTable(table);
      result.forEach((row) => expect(row.avatarUrl).toBeNull());
    });

    it('a table of already-migrated rows is unchanged after re-running the migration', () => {
      const table = [
        { id: 1, avatarUrl: '/api/uploads/user1.jpg' },
        { id: 2, avatarUrl: '/api/uploads/user2.png' },
        { id: 3, avatarUrl: null },
      ];
      const result = migrateTable(table);
      expect(result[0].avatarUrl).toBe('/api/uploads/user1.jpg');
      expect(result[1].avatarUrl).toBe('/api/uploads/user2.png');
      expect(result[2].avatarUrl).toBeNull();
    });

    it('migrating a mixed table twice produces the same result as migrating once', () => {
      const table = [
        { id: 1, avatarUrl: '/uploads/user1.jpg' },
        { id: 2, avatarUrl: null },
        { id: 3, avatarUrl: '/api/uploads/user3.png' },
      ];
      const once = migrateTable(table);
      const twice = migrateTable(once);
      expect(twice).toEqual(once);
    });
  });
});

// ===========================================================================
// 10. Migration SQL file exists and contains the required statement
// ===========================================================================

describe('Migration SQL file', () => {
  let sqlContent: string;

  beforeAll(() => {
    sqlContent = fs.readFileSync(MIGRATION_FILE, 'utf8');
  });

  it('the migration file exists at the expected path', () => {
    expect(fs.existsSync(MIGRATION_FILE)).toBe(true);
  });

  it('contains an UPDATE statement targeting the settings table', () => {
    expect(sqlContent).toMatch(/UPDATE\s+"settings"/i);
  });

  it('contains a SET clause that calls REPLACE on avatar_url', () => {
    expect(sqlContent).toMatch(/SET\s+"avatar_url"\s*=\s*REPLACE\("avatar_url"/i);
  });

  it('replaces /uploads/ with /api/uploads/ in the REPLACE call', () => {
    expect(sqlContent).toContain("'/uploads/'");
    expect(sqlContent).toContain("'/api/uploads/'");
  });

  it('contains a WHERE clause guarded by LIKE \'/uploads/%\'', () => {
    expect(sqlContent).toMatch(/WHERE\s+"avatar_url"\s+LIKE\s+'\/uploads\/%'/i);
  });

  it('the REPLACE arguments appear in the correct order (from → to)', () => {
    // REPLACE("avatar_url", '/uploads/', '/api/uploads/')
    const replaceIdx = sqlContent.indexOf("'/uploads/'");
    const withIdx = sqlContent.indexOf("'/api/uploads/'");
    expect(replaceIdx).toBeGreaterThan(-1);
    expect(withIdx).toBeGreaterThan(-1);
    // '/uploads/' must appear before '/api/uploads/' in the REPLACE call
    expect(replaceIdx).toBeLessThan(withIdx);
  });
});
