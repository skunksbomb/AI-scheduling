import { NextResponse } from "next/server";
import { getTasks, updateTask } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ tasks: getTasks() });
}

export async function PATCH(request) {
  const { id, ...patch } = await request.json();
  if (!id) {
    return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
  }
  const tasks = updateTask(id, patch);
  return NextResponse.json({ tasks });
}
