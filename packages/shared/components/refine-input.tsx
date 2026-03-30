"use client";
import { apiFetch } from "../lib/api-client";

import { useCallback, useRef, useState } from "react";

interface RefineMessage {
  role: "user" | "assistant";
  text: string;
}

interface RefineInputProps {
  /** The original evaluation context/prompt to continue the conversation */
  originalContext: string;
  /** The original evaluation response to reference */
  originalResponse: string;
}

export function RefineInput({
  originalContext,
  originalResponse,
}: RefineInputProps) {
  // Dev-only tool for tuning prompts — hidden in production
  if (process.env.NODE_ENV !== "development") return null;
  const [messages, setMessages] = useState<RefineMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput("");
    const newMessages = [...messages, { role: "user" as const, text }];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      const res = await apiFetch("/api/evaluate", {
        method: "POST",
        body: JSON.stringify({
          type: "map",
          context: null,
          mapPrompt: `Previous evaluation context:
${originalContext}

Previous recommendation:
${originalResponse}

Conversation so far:
${newMessages.map((m) => `${m.role}: ${m.text}`).join("\n")}

Respond to the user's follow-up. Be concise (2-3 sentences). Respond as JSON:
{"response": "your response here"}`,
          runId: null,
          gameVersion: null,
        }),
      });

      const data = await res.json();
      const response = data.response ?? data.overall_advice ?? "Sorry, I couldn't process that.";
      setMessages([...newMessages, { role: "assistant", text: response }]);
    } catch {
      setMessages([...newMessages, { role: "assistant", text: "Failed to get response." }]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [input, isLoading, messages, originalContext, originalResponse]);

  return (
    <div className="space-y-3">
      {/* Messages */}
      {messages.length > 0 && (
        <div className="space-y-2">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={
                msg.role === "user"
                  ? "text-sm text-zinc-300"
                  : "text-sm text-zinc-400 bg-zinc-800/30 rounded-lg px-3 py-2"
              }
            >
              {msg.role === "user" && (
                <span className="text-zinc-500 mr-1">You:</span>
              )}
              {msg.text}
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder="Ask a follow-up or provide more context..."
          disabled={isLoading}
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={isLoading || !input.trim()}
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-50"
        >
          {isLoading ? "..." : "Ask"}
        </button>
      </div>
    </div>
  );
}
