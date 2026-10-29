import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ jsonrpc: '2.0', result: {}, error: null });
}

export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
