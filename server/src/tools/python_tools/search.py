import sys
import json
import argparse
import urllib.request
import urllib.parse
import re

# Standard search function using DuckDuckGo HTML parsing
def search_duckduckgo(query):
    try:
        url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(query)}"
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'}
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            html = response.read().decode('utf-8', errors='ignore')
        
        # Simple regex matching for result blocks
        results = []
        blocks = re.findall(r'<div class="result(?: results_links)?.*?">([\s\S]*?)(?=<div class="result|$)', html)
        for block in blocks[:5]:
            title_match = re.search(r'<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>', block)
            snippet_match = re.search(r'<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>', block) or re.search(r'<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>', block)
            
            if title_match:
                raw_link = title_match.group(1).strip()
                if 'uddg=' in raw_link:
                    link = urllib.parse.unquote(raw_link.split('uddg=')[1].split('&')[0])
                else:
                    link = raw_link if raw_link.startswith('http') else 'https:' + raw_link
                
                title = re.sub(r'<[^>]*>', '', title_match.group(2)).strip()
                snippet = re.sub(r'<[^>]*>', '', snippet_match.group(1)).strip() if snippet_match else ""
                
                # Unescape HTML entities
                title = title.replace('&amp;', '&').replace('&quot;', '"').replace('&#39;', "'").replace('&lt;', '<').replace('&gt;', '>')
                snippet = snippet.replace('&amp;', '&').replace('&quot;', '"').replace('&#39;', "'").replace('&lt;', '<').replace('&gt;', '>')
                
                results.append({
                    "title": title,
                    "link": link,
                    "snippet": snippet
                })
        return results
    except Exception as e:
        return [{"title": "Error", "link": "", "snippet": f"DuckDuckGo search failed: {str(e)}"}]

def search_wikipedia(query):
    try:
        # Search wikipedia articles
        url = f"https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={urllib.parse.quote(query)}&format=json"
        req = urllib.request.Request(url, headers={'User-Agent': 'JarvisAssistant/1.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
        
        search_results = data.get("query", {}).get("search", [])
        results = []
        for item in search_results[:5]:
            title = item.get("title")
            pageid = item.get("pageid")
            snippet = re.sub(r'<[^>]*>', '', item.get("snippet", "")).strip()
            # Unescape HTML entities
            snippet = snippet.replace('&amp;', '&').replace('&quot;', '"').replace('&#39;', "'").replace('&lt;', '<').replace('&gt;', '>')
            link = f"https://en.wikipedia.org/?curid={pageid}"
            results.append({
                "title": title,
                "link": link,
                "snippet": snippet
            })
        return results
    except Exception as e:
        return search_duckduckgo(query)

def search_news(query):
    news_query = f"{query} news" if "news" not in query.lower() else query
    return search_duckduckgo(news_query)

def search_youtube(query):
    try:
        url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}"
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'}
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            html = response.read().decode('utf-8', errors='ignore')
        
        video_ids = re.findall(r'"videoId":"([^"]{11})"', html)
        seen = set()
        results = []
        for vid in video_ids:
            if vid in seen:
                continue
            seen.add(vid)
            link = f"https://www.youtube.com/watch?v={vid}"
            
            idx = html.find(vid)
            chunk = html[max(0, idx-1500):min(len(html), idx+2500)]
            title_match = re.search(r'"title":\{"runs":\[\{"text":"([^"]+)"', chunk) or re.search(r'"title":\{"simpleText":"([^"]+)"', chunk)
            title = title_match.group(1).replace('\\u0026', '&').replace('\\"', '"') if title_match else query
            
            results.append({
                "title": title,
                "link": link,
                "snippet": f"Watch video '{title}' on YouTube."
            })
            if len(results) >= 5:
                break
        return results
    except Exception as e:
        return search_duckduckgo(query)

def search_github(query):
    try:
        url = f"https://api.github.com/search/repositories?q={urllib.parse.quote(query)}"
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'JarvisAssistant/1.0',
                'Accept': 'application/vnd.github+json'
            }
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
        
        items = data.get("items", [])
        results = []
        for item in items[:5]:
            results.append({
                "title": item.get("full_name"),
                "link": item.get("html_url"),
                "snippet": f"{item.get('description')} (Stars: {item.get('stargazers_count')}, Language: {item.get('language')})"
            })
        return results
    except Exception as e:
        return search_duckduckgo(query)

def search_weather(query):
    try:
        # Resolve coordinates
        geo_url = f"https://geocoding-api.open-meteo.com/v1/search?name={urllib.parse.quote(query)}&count=1&language=en&format=json"
        req = urllib.request.Request(geo_url, headers={'User-Agent': 'JarvisAssistant/1.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            geo_data = json.loads(response.read().decode('utf-8'))
        
        results = geo_data.get("results", [])
        if not results:
            return [{"title": f"Weather for {query}", "link": "", "snippet": f"Could not find coordinates for location: {query}"}]
        
        loc = results[0]
        name = loc.get("name")
        country = loc.get("country", "")
        lat = loc.get("latitude")
        lon = loc.get("longitude")
        
        # Fetch weather
        weather_url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m"
        req2 = urllib.request.Request(weather_url, headers={'User-Agent': 'JarvisAssistant/1.0'})
        with urllib.request.urlopen(req2, timeout=10) as response2:
            weather_data = json.loads(response2.read().decode('utf-8'))
        
        current = weather_data.get("current", {})
        temp = current.get("temperature_2m")
        humidity = current.get("relative_humidity_2m")
        wind = current.get("wind_speed_10m")
        
        weather_desc = {
            0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
            45: "Fog", 48: "Depositing rime fog",
            51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
            61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
            71: "Slight snow fall", 73: "Moderate snow fall", 75: "Heavy snow fall",
            80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers"
        }.get(current.get("weather_code", -1), "Unknown weather conditions")

        snippet = f"Current weather in {name}, {country}: {weather_desc}, Temperature: {temp}°C, Humidity: {humidity}%, Wind Speed: {wind} km/h."
        return [{
            "title": f"Weather Report: {name}, {country}",
            "link": f"https://open-meteo.com/en/forecast?latitude={lat}&longitude={lon}",
            "snippet": snippet
        }]
    except Exception as e:
        return search_duckduckgo(f"{query} weather")

def classify_provider(query):
    query_lower = query.lower()
    if any(k in query_lower for k in ["weather", "temperature", "forecast", "rain", "humidity", "wind"]):
        return "weather"
    if any(k in query_lower for k in ["github", "repository", "repo", "source code", "open source"]):
        return "github"
    if any(k in query_lower for k in ["youtube", "watch video", "play video", "yt video"]):
        return "youtube"
    if any(k in query_lower for k in ["news", "headline", "headlines", "current events", "latest updates"]):
        return "news"
        
    wiki_patterns = [
        r"\bwho is\b", r"\bwho was\b", r"\bwhat is\b", r"\bwhat was\b",
        r"\btell me about\b", r"\bdefine\b", r"\bhistory of\b", r"\bbiography of\b"
    ]
    if any(re.search(pattern, query_lower) for pattern in wiki_patterns):
        return "wikipedia"
        
    return "google"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--query', required=True)
    parser.add_argument('--provider', default='auto', choices=['auto', 'wikipedia', 'google', 'news', 'youtube', 'github', 'weather'])
    args = parser.parse_args()

    provider = args.provider
    if provider == 'auto':
        provider = classify_provider(args.query)

    results = []
    if provider == 'wikipedia':
        results = search_wikipedia(args.query)
    elif provider == 'google':
        results = search_duckduckgo(args.query)
    elif provider == 'news':
        results = search_news(args.query)
    elif provider == 'youtube':
        results = search_youtube(args.query)
    elif provider == 'github':
        results = search_github(args.query)
    elif provider == 'weather':
        results = search_weather(args.query)

    print(json.dumps({
        "success": True,
        "provider": provider,
        "query": args.query,
        "results": results
    }, indent=2))

if __name__ == '__main__':
    main()
