-- Pull request yield: what a fix row says beyond its verdict.
--
-- details_json holds the optional extensions of FixPayload that have no column
-- of their own: alsoResolved (symptom findings that stopped firing in this
-- fix's verify run), mappingNote (how the source file was found, or what was
-- searched when none was) and attempts (2 = retried once). NULL on older rows.
--
-- The Worker runs this file itself when the column is missing (src/db.ts
-- ensureSchema).

ALTER TABLE fixes ADD COLUMN details_json TEXT;
