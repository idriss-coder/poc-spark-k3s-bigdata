import { NextResponse, NextRequest } from "next/server";
import CONFIG from "../../../lib/config";

async function proxyRequest(req: NextRequest) {
  // Extract path to forward
  const path = req.nextUrl.pathname.replace("/api/proxy", "");
  const targetUrl = `${CONFIG.API_URL}${path}${req.nextUrl.search}`;

  try {
    const headers = new Headers(req.headers);
    headers.delete("host");

    const init: RequestInit = {
      method: req.method,
      headers,
      cache: "no-store",
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      init.body = await req.arrayBuffer();
    }

    const res = await fetch(targetUrl, init);
    const body = await res.arrayBuffer();
    
    const responseHeaders = new Headers(res.headers);
    // Don't forward content-encoding or transfer-encoding to let Next.js handle it
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("transfer-encoding");

    return new NextResponse(body, {
      status: res.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Proxy error:", error);
    return NextResponse.json({ error: "Proxy request failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return proxyRequest(req); }
export async function POST(req: NextRequest) { return proxyRequest(req); }
export async function PUT(req: NextRequest) { return proxyRequest(req); }
export async function PATCH(req: NextRequest) { return proxyRequest(req); }
export async function DELETE(req: NextRequest) { return proxyRequest(req); }
