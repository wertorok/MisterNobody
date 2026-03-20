# Firecrawl CLI Skill

## Description

Use Firecrawl CLI directly from Claude Code to scrape, crawl, and extract structured data from websites — converting any URL into clean markdown or JSON for AI pipelines.

## Installation

```bash
npm install -g firecrawl-cli
```

Set your API key:

```bash
export FIRECRAWL_API_KEY=your_key_here
```

Or log in interactively:

```bash
firecrawl login
```

## Usage

Invoke with `/firecrawl [command]` or ask Claude to run a Firecrawl command.

## Commands

```bash
# Scrape a single URL → markdown
firecrawl scrape https://example.com

# Scrape and save to file
firecrawl scrape https://example.com --output page.md

# Crawl an entire site (follows links)
firecrawl crawl https://example.com

# Crawl with depth and page limits
firecrawl crawl https://docs.example.com --max-depth 3 --limit 50

# Extract structured data with a prompt
firecrawl extract https://example.com --prompt "extract product name, price, and description"

# Map all URLs of a site
firecrawl map https://example.com

# Batch scrape multiple URLs
firecrawl batch-scrape urls.txt

# Check crawl job status
firecrawl status <job-id>
```

## Output Formats

```bash
# Output as JSON
firecrawl scrape https://example.com --format json

# Output as markdown (default)
firecrawl scrape https://example.com --format markdown

# Include metadata (title, description, og tags)
firecrawl scrape https://example.com --include-metadata
```

## Features

- Renders JavaScript-heavy SPAs before scraping
- Bypasses bot detection and CAPTCHAs
- Returns clean markdown without ads/nav/boilerplate
- Structured extraction with natural language prompts
- Site-wide crawling with configurable depth and limits
- Async job system for large crawls

## Notes

- Requires a Firecrawl account and API key from firecrawl.dev
- Free tier available with rate limits
- Large crawls run asynchronously — use `firecrawl status <job-id>` to poll
