-- SeedData: a default profile matching CITI_DEFAULT_MAPPING
-- (packages/core/src/csvColumnMapping.ts) so real Citi exports auto-detect
-- via the configurator's preview step from day one — no manual
-- reconfiguration needed for the common case, only for a genuinely new
-- CSV shape.
INSERT INTO "CsvImportProfile" ("name", "hasHeader", "columnCount", "headerSignature", "columnMappingJson") VALUES (
  'Citi (default)',
  1,
  6,
  'status,date,description,debit,credit,member name',
  '{"hasHeader":true,"dateColumn":{"byName":"date"},"descriptionColumn":{"byName":"description"},"amount":{"mode":"DEBIT_CREDIT","debitColumn":{"byName":"debit"},"creditColumn":{"byName":"credit"}}}'
);
