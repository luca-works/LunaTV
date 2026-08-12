import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(_request: Request) {
  return NextResponse.json(
    { error: '注册功能已禁用' },
    { status: 404 }
  );
}
