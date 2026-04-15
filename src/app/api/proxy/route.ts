import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_ORIGINS = [
  'https://data.binance.vision',
  'https://public.bybit.com',
];

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url');
  if (!raw) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  const allowed = ALLOWED_ORIGINS.some((o) => raw.startsWith(o));
  if (!allowed) {
    return NextResponse.json({ error: 'URL not allowed' }, { status: 403 });
  }

  try {
    const upstream = await fetch(parsed.toString(), { headers: { 'User-Agent': 'hltReplay/1.0' } });
    if (!upstream.ok) {
      return NextResponse.json({ error: `Upstream ${upstream.status}` }, { status: upstream.status });
    }

    const body = await upstream.arrayBuffer();
    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
