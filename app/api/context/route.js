import { NextResponse } from "next/server";
import { getUserContext, setUserContext } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ context: await getUserContext() });
}

export async function PUT(request) {
  const { text } = await request.json();
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  await setUserContext(lines);
  return NextResponse.json({ context: lines });
}
