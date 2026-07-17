import { SettingsDb } from '../memory/db';

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Scrape free DuckDuckGo HTML interface
async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo request failed with status: ${response.status}`);
    }

    const html = await response.text();
    const results: SearchResult[] = [];
    
    const resultBlockRegex = /<div class="result(?: results_links)?[\s\S]*?">([\s\S]*?)(?=<div class="result|$)/g;
    let match;
    let limit = 5;

    while ((match = resultBlockRegex.exec(html)) !== null && limit > 0) {
      const block = match[1];

      const titleLinkMatch =
        /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block) ||
        /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
      const snippetMatch =
        /<a[^>]*class="result__snippet"[\s\S]*?>([\s\S]*?)<\/a>/.exec(block) ||
        /<div[^>]*class="result__snippet"[\s\S]*?>([\s\S]*?)<\/div>/.exec(block);

      if (titleLinkMatch) {
        const rawLink = titleLinkMatch[1].trim();
        const link = rawLink.includes('uddg=')
          ? decodeURIComponent(rawLink.split('uddg=')[1].split('&')[0])
          : rawLink.replace(/^\/\//, 'https://');

        const title = decodeHtml(titleLinkMatch[2]);
        const snippet = snippetMatch ? decodeHtml(snippetMatch[1]) : '';

        if (title && link) {
          results.push({ title, link, snippet });
          limit--;
        }
      }
    }

    return results;
  } catch (e: any) {
    console.error("DuckDuckGo scraping failed:", e);
    return [];
  }
}

// Brave Search API
async function searchBrave(query: string, apiKey: string): Promise<SearchResult[]> {
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey
      }
    });

    if (response.ok) {
      const data = await response.json() as any;
      const results: SearchResult[] = [];
      const items = data.web?.results || [];
      for (const item of items.slice(0, 5)) {
        results.push({
          title: item.title,
          link: item.url,
          snippet: item.description
        });
      }
      return results;
    } else {
      throw new Error(`Brave Search API HTTP status ${response.status}`);
    }
  } catch (e) {
    console.error("Brave search failed, falling back to DuckDuckGo:", e);
    return searchDuckDuckGo(query);
  }
}

// Tavily Search API
async function searchTavily(query: string, apiKey: string): Promise<SearchResult[]> {
  try {
    const url = 'https://api.tavily.com/search';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 5
      })
    });

    if (response.ok) {
      const data = await response.json() as any;
      const results: SearchResult[] = [];
      const items = data.results || [];
      for (const item of items) {
        results.push({
          title: item.title,
          link: item.url,
          snippet: item.content
        });
      }
      return results;
    } else {
      throw new Error(`Tavily Search API HTTP status ${response.status}`);
    }
  } catch (e) {
    console.error("Tavily search failed, falling back to DuckDuckGo:", e);
    return searchDuckDuckGo(query);
  }
}

export const SearchHelper = {
  async search(query: string): Promise<SearchResult[]> {
    const provider = SettingsDb.get('search_provider', 'DUCKDUCKGO');
    
    if (provider === 'BRAVE') {
      const apiKey = SettingsDb.get('brave_key', '');
      if (apiKey) {
        return searchBrave(query, apiKey);
      }
    } else if (provider === 'TAVILY') {
      const apiKey = SettingsDb.get('tavily_key', '');
      if (apiKey) {
        return searchTavily(query, apiKey);
      }
    }

    // Default or Fallback
    return searchDuckDuckGo(query);
  }
};
