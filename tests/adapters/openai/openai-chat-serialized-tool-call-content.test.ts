import { expect, test } from "bun:test";
import { createOpenAIChatAdapter } from "../../../src/adapters/openai-chat";
import { SerializedToolCallContentBuffer } from "../../../src/adapters/openai-chat/serialized-tool-call-content";
import { createTestTranslatorBudget } from "../../helpers/translator-budget";

const provider = { adapter: "openai-chat", baseUrl: "https://openrouter.ai/api/v1", apiKey: "key" } as const;

test("buffered Chat responses reconcile matching serialized and structured tool calls", async () => {
  const script = "text('ok');";
  const content = `Running it.\n<tool_call><function=exec>${script}\n</parameter></function></tool_call>`;
  const events = await createOpenAIChatAdapter(provider).parseResponse!(Response.json({
    choices: [{
      message: {
        content,
        tool_calls: [{
          id: "call_exec",
          function: { name: "exec", arguments: script + JSON.stringify({ input: script }) },
        }],
      },
      finish_reason: "tool_calls",
    }],
  }), createTestTranslatorBudget());

  expect(events.filter(event => event.type === "text_delta")).toEqual([
    { type: "text_delta", text: "Running it.\n" },
  ]);
  expect(events.find(event => event.type === "tool_call_delta")).toEqual({
    type: "tool_call_delta",
    arguments: JSON.stringify({ input: script }),
  });
});

test("buffered Chat responses reconcile two identical echoed blocks and doubled input", async () => {
  const script = "const names = []; text(names);";
  const block = `<tool_call><function=exec>${script}</parameter></function></tool_call>`;
  const events = await createOpenAIChatAdapter(provider).parseResponse!(Response.json({
    choices: [{
      message: {
        content: block + block,
        tool_calls: [{
          id: "call_exec",
          function: { name: "exec", arguments: JSON.stringify({ input: script + script }) },
        }],
      },
      finish_reason: "tool_calls",
    }],
  }), createTestTranslatorBudget());

  expect(events.filter(event => event.type === "text_delta")).toEqual([]);
  expect(events.find(event => event.type === "tool_call_delta")).toEqual({
    type: "tool_call_delta",
    arguments: JSON.stringify({ input: script }),
  });
});

test("buffered Chat responses suppress two echoed blocks when structured input is already single", async () => {
  const script = "text('ok');";
  const block = `<tool_call><function=exec>${script}</parameter></function></tool_call>`;
  const events = await createOpenAIChatAdapter(provider).parseResponse!(Response.json({
    choices: [{
      message: {
        content: block + block,
        tool_calls: [{
          id: "call_exec",
          function: { name: "exec", arguments: JSON.stringify({ input: script }) },
        }],
      },
      finish_reason: "tool_calls",
    }],
  }), createTestTranslatorBudget());

  expect(events.filter(event => event.type === "text_delta")).toEqual([]);
  expect(events.find(event => event.type === "tool_call_delta")).toEqual({
    type: "tool_call_delta",
    arguments: JSON.stringify({ input: script }),
  });
});

test("buffered Chat responses suppress two echoed blocks with a trailing newline", async () => {
  const script = "text('ok');";
  const block = `<tool_call><function=exec>${script}</parameter></function></tool_call>`;
  const events = await createOpenAIChatAdapter(provider).parseResponse!(Response.json({
    choices: [{
      message: {
        content: block + block + "\n",
        tool_calls: [{ id: "call_exec", function: { name: "exec", arguments: JSON.stringify({ input: script }) } }],
      },
      finish_reason: "tool_calls",
    }],
  }), createTestTranslatorBudget());

  expect(events.filter(event => event.type === "text_delta")).toEqual([]);
  expect(events.find(event => event.type === "tool_call_delta")).toEqual({
    type: "tool_call_delta", arguments: JSON.stringify({ input: script }),
  });
});

test("buffered Chat responses repair two echoed blocks with newline-joined input", async () => {
  const script = "text('ok');";
  const block = `<tool_call><function=exec>${script}</parameter></function></tool_call>`;
  const events = await createOpenAIChatAdapter(provider).parseResponse!(Response.json({
    choices: [{
      message: {
        content: block + block,
        tool_calls: [{ id: "call_exec", function: { name: "exec", arguments: JSON.stringify({ input: script + "\n" + script }) } }],
      },
      finish_reason: "tool_calls",
    }],
  }), createTestTranslatorBudget());

  expect(events.filter(event => event.type === "text_delta")).toEqual([]);
  expect(events.find(event => event.type === "tool_call_delta")).toEqual({
    type: "tool_call_delta", arguments: JSON.stringify({ input: script }),
  });
});

test("buffered Chat responses suppress a repeated echo beside an unrelated structured call", async () => {
  const script = "text('ok');";
  const block = `<tool_call><function=exec>${script}</parameter></function></tool_call>`;
  const events = await createOpenAIChatAdapter(provider).parseResponse!(Response.json({
    choices: [{
      message: {
        content: block + block,
        tool_calls: [
          { id: "call_exec", function: { name: "exec", arguments: JSON.stringify({ input: script }) } },
          { id: "call_other", function: { name: "other", arguments: JSON.stringify({ input: "other" }) } },
        ],
      },
      finish_reason: "tool_calls",
    }],
  }), createTestTranslatorBudget());

  expect(events.filter(event => event.type === "text_delta")).toEqual([]);
  expect(events.filter(event => event.type === "tool_call_delta")).toEqual([
    { type: "tool_call_delta", arguments: JSON.stringify({ input: script }) },
    { type: "tool_call_delta", arguments: JSON.stringify({ input: "other" }) },
  ]);
});

test("buffered Chat responses preserve repeated markup when two structured calls match", async () => {
  const script = "text('ok');";
  const block = `<tool_call><function=exec>${script}</parameter></function></tool_call>`;
  const content = block + block;
  const argumentsText = JSON.stringify({ input: script });
  const events = await createOpenAIChatAdapter(provider).parseResponse!(Response.json({
    choices: [{
      message: {
        content,
        tool_calls: [
          { id: "call_one", function: { name: "exec", arguments: argumentsText } },
          { id: "call_two", function: { name: "exec", arguments: argumentsText } },
        ],
      },
      finish_reason: "tool_calls",
    }],
  }), createTestTranslatorBudget());

  expect(events.filter(event => event.type === "text_delta")).toEqual([{ type: "text_delta", text: content }]);
  expect(events.filter(event => event.type === "tool_call_delta")).toEqual([
    { type: "tool_call_delta", arguments: argumentsText },
    { type: "tool_call_delta", arguments: argumentsText },
  ]);
});

test("buffered Chat responses preserve repeated markup when the structured input differs", async () => {
  const script = "text('example');";
  const content = `<tool_call><function=exec>${script}</function></tool_call>`.repeat(2);
  const argumentsText = JSON.stringify({ input: script + "text('other');" });
  const events = await createOpenAIChatAdapter(provider).parseResponse!(Response.json({
    choices: [{
      message: {
        content,
        tool_calls: [{ id: "call_exec", function: { name: "exec", arguments: argumentsText } }],
      },
      finish_reason: "tool_calls",
    }],
  }), createTestTranslatorBudget());

  expect(events.find(event => event.type === "text_delta")).toEqual({ type: "text_delta", text: content });
  expect(events.find(event => event.type === "tool_call_delta")).toEqual({
    type: "tool_call_delta",
    arguments: argumentsText,
  });
});

test("buffered Chat responses preserve serialized markup for a different function", async () => {
  const content = "<tool_call><function=other>literal example</function></tool_call>";
  const events = await createOpenAIChatAdapter(provider).parseResponse!(Response.json({
    choices: [{
      message: {
        content,
        tool_calls: [{ id: "call_exec", function: { name: "exec", arguments: "{}" } }],
      },
      finish_reason: "tool_calls",
    }],
  }), createTestTranslatorBudget());

  expect(events.find(event => event.type === "text_delta")).toEqual({ type: "text_delta", text: content });
});

test("an open serialized block charges only its appended bytes", () => {
  const open = "<tool_call><function=exec>";
  const body = "x".repeat(open.length);
  // Rebuilding the whole buffer would reserve the new total beside the retained
  // text, so this exact budget only admits the append when it charges the delta.
  const budget = createTestTranslatorBudget({ maxTurnBytes: open.length + body.length });
  const buffer = new SerializedToolCallContentBuffer(budget);

  expect(buffer.ingest(open)).toBe("");
  expect(buffer.ingest(body)).toBe("");
  expect(buffer.current()).toBe(open + body);
  expect(budget.snapshot()).toMatchObject({ currentBytes: open.length + body.length, overflows: 0 });

  expect(buffer.flush([])).toBe(open + body);
  expect(budget.snapshot()).toMatchObject({ currentBytes: 0, overflows: 0 });
});
