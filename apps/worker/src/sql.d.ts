// wrangler.toml has a Text rule for *.sql, so these import as strings.
declare module "*.sql" {
  const sql: string;
  export default sql;
}
