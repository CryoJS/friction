-- What the crawl's Fetch pre-pass bought: pages read over Browserbase's Fetch
-- API, browser sessions opened anyway, and pages that never needed one. Stored
-- as the CrawlSurvey JSON object, null for every scan crawled before Fetch.

ALTER TABLE scans ADD COLUMN survey TEXT;
