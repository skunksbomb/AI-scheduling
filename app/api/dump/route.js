import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { addTasks } from "@/lib/store";
import { parseDumpText } from "@/lib/ai";

export async function POST(request) {
  const { text } = await request.json();

  if (!text || !text.trim()) {
    return NextResponse.json({ error: "내용을 입력해주세요." }, { status: 400 });
  }

  let parsedItems;
  try {
    parsedItems = await parseDumpText(text);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const newTasks = parsedItems.map((item) => ({
    id: randomUUID(),
    title: item.title ?? text,
    deadline: item.deadline ?? null,
    urgent: Boolean(item.urgent),
    important: Boolean(item.important),
    estimatedMinutes: item.estimatedMinutes ?? 60,
    done: false,
    rawText: text,
    createdAt: new Date().toISOString(),
  }));

  const tasks = addTasks(newTasks);
  return NextResponse.json({ tasks });
}
