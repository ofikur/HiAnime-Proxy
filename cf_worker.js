addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

async function handleRequest(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);

  if (url.pathname === "/" || url.pathname === "/m3u8-proxy") {
    return handleM3U8Proxy(request);
  } else if (url.pathname === "/ts-proxy") {
    return handleTsProxy(request);
  }

  return new Response("Not Found", { status: 404, headers: corsHeaders });
}

const options = {
  originBlacklist: [],
  originWhitelist: ["*"],
};

const isOriginAllowed = (origin, options) => {
  if (options.originWhitelist.includes("*")) return true;
  if (options.originWhitelist.length && !options.originWhitelist.includes(origin)) return false;
  if (options.originBlacklist.length && options.originBlacklist.includes(origin)) return false;
  return true;
};

const getFakeHeaders = (targetUrl, customHeaders) => {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://rapid-cloud.co/",
    "Origin": "https://rapid-cloud.co",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "Connection": "keep-alive",
    ...customHeaders
  };
};

async function handleM3U8Proxy(request) {
  const reqUrl = new URL(request.url);
  const targetUrl = reqUrl.searchParams.get("url");
  const headers = JSON.parse(reqUrl.searchParams.get("headers") || "{}");
  const origin = request.headers.get("Origin") || "";
  const hostOrigin = reqUrl.origin; 

  if (!isOriginAllowed(origin, options)) {
    return new Response(`The origin "${origin}" is not allowed.`, { status: 403, headers: corsHeaders });
  }
  if (!targetUrl) {
    return new Response("URL is required", { status: 400, headers: corsHeaders });
  }

  try {
    const response = await fetch(targetUrl, { 
      method: "GET",
      headers: getFakeHeaders(targetUrl, headers) 
    });

    if (!response.ok) {
      return new Response(`Failed to fetch the m3u8 file. Server responded with ${response.status}`, {
        status: response.status,
        headers: corsHeaders,
      });
    }

    let m3u8 = await response.text();
    m3u8 = m3u8
      .split("\n")
      .filter((line) => !line.startsWith("#EXT-X-MEDIA:TYPE=AUDIO"))
      .join("\n");

    const lines = m3u8.split("\n");
    const newLines = [];

    lines.forEach((line) => {
      if (line.trim() === "") return;

      if (line.startsWith("#")) {
        if (line.startsWith("#EXT-X-KEY:")) {
          const regex = /https?:\/\/[^\""\s]+/g;
          const keyUrl = regex.exec(line)?.[0] ?? "";
          const newUrl = `${hostOrigin}/ts-proxy?url=${encodeURIComponent(keyUrl)}&headers=${encodeURIComponent(JSON.stringify(headers))}`;
          newLines.push(line.replace(keyUrl, newUrl));
        } else {
          newLines.push(line);
        }
      } else {
        try {
          const uri = new URL(line, targetUrl);
          newLines.push(`${hostOrigin}/ts-proxy?url=${encodeURIComponent(uri.href)}&headers=${encodeURIComponent(JSON.stringify(headers))}`);
        } catch (e) {
          newLines.push(line);
        }
      }
    });

    return new Response(newLines.join("\n"), {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        ...corsHeaders,
      },
    });
  } catch (error) {
    return new Response(error.message, { status: 500, headers: corsHeaders });
  }
}

async function handleTsProxy(request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");
  const headers = JSON.parse(searchParams.get("headers") || "{}");
  const origin = request.headers.get("Origin") || "";

  if (!isOriginAllowed(origin, options)) {
    return new Response(`The origin "${origin}" is not allowed.`, { status: 403, headers: corsHeaders });
  }
  if (!targetUrl) {
    return new Response("URL is required", { status: 400, headers: corsHeaders });
  }

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: getFakeHeaders(targetUrl, headers),
    });

    if (!response.ok) {
      return new Response("Failed to fetch segment", { status: response.status, headers: corsHeaders });
    }

    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": "video/mp2t",
        ...corsHeaders,
      },
    });
  } catch (error) {
    return new Response(error.message, { status: 500, headers: corsHeaders });
  }
}
