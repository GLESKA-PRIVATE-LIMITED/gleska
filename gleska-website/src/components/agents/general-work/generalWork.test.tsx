import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneralWorkConversation, MessageExchange } from "@/lib/general-work-api";

const mocks = vi.hoisted(() => ({
  api: {
    listConversations: vi.fn(),
    listProjects: vi.fn(),
    createConversation: vi.fn(),
    getConversation: vi.fn(),
    listMessages: vi.fn(),
    sendMessage: vi.fn(),
    uploadFile: vi.fn(),
    deleteFile: vi.fn(),
    transcribe: vi.fn(),
  },
  routerPush: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/general-work-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/general-work-api")>();
  return { ...actual, generalWorkApi: mocks.api };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.routerPush, replace: vi.fn() }),
  usePathname: () => "/general-work",
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn(), info: vi.fn() },
}));

import ChatComposer from "./ChatComposer";
import ChatWorkspace from "./ChatWorkspace";
import { GeneralWorkProvider } from "./GeneralWorkContext";
import MarkdownContent from "./MarkdownContent";
import { classifyFile } from "./useAttachmentUploads";
import { dateGroupLabel, groupByDate } from "./dateGroups";

const conversation: GeneralWorkConversation = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Prepare a business proposal",
  project_id: null,
  created_at: "2026-10-30T10:00:00Z",
  updated_at: "2026-10-30T10:00:00Z",
  last_message_at: "2026-10-30T10:00:05Z",
};

function exchangeFor(content: string, clientMessageId: string): MessageExchange {
  return {
    conversation,
    user_message: {
      id: "user-msg",
      conversation_id: conversation.id,
      role: "user",
      content,
      attachments: [],
      status: "completed",
      client_message_id: clientMessageId,
      created_at: "2026-10-30T10:00:01Z",
    },
    assistant_message: {
      id: "assistant-msg",
      conversation_id: conversation.id,
      role: "assistant",
      content: "## Proposal outline\n\n| Section | Owner |\n| --- | --- |\n| Scope | Ops |",
      attachments: [],
      status: "completed",
      client_message_id: null,
      created_at: "2026-10-30T10:00:05Z",
    },
  };
}

beforeEach(() => {
  Object.values(mocks.api).forEach((fn) => fn.mockReset());
  mocks.api.listConversations.mockResolvedValue([]);
  mocks.api.listProjects.mockResolvedValue([]);
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("dateGroups", () => {
  it("labels and groups conversations by relative date", () => {
    const now = new Date(2026, 9, 30, 12);
    expect(dateGroupLabel(new Date(2026, 9, 30, 8).toISOString(), now)).toBe("Today");
    expect(dateGroupLabel(new Date(2026, 9, 29, 8).toISOString(), now)).toBe("Yesterday");
    expect(dateGroupLabel(new Date(2026, 9, 25).toISOString(), now)).toBe("Previous 7 days");
    const groups = groupByDate(
      [new Date(2026, 9, 30, 9), new Date(2026, 9, 30, 7), new Date(2026, 9, 29, 7)].map((d) => d.toISOString()),
      (value) => value,
      now,
    );
    expect(groups.map((group) => [group.label, group.items.length])).toEqual([["Today", 2], ["Yesterday", 1]]);
  });
});

describe("classifyFile", () => {
  it("accepts supported images and documents and rejects others", () => {
    expect(classifyFile(new File(["x"], "photo.JPG"))).toEqual({ kind: "image" });
    expect(classifyFile(new File(["x"], "report.pdf"))).toEqual({ kind: "document" });
    expect(classifyFile(new File(["x"], "virus.exe"))).toEqual({ error: "virus.exe isn't a supported file type." });
    expect(classifyFile(new File([], "empty.txt"))).toEqual({ error: "empty.txt is empty." });
    const big = new File(["x"], "huge.png");
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    expect(classifyFile(big)).toEqual({ error: "huge.png is larger than 10.0 MB." });
  });
});

describe("MarkdownContent", () => {
  it("renders tables and code but never raw HTML or remote images", () => {
    const { container } = render(
      <MarkdownContent
        content={"| A | B |\n| - | - |\n| 1 | 2 |\n\n```python\nprint('hi')\n```\n\n<script>alert(1)</script><b>bold</b>\n\n![track](https://evil.example/pixel.png)"}
      />,
    );
    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.getByText("print('hi')")).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("[image: track]")).toBeTruthy();
  });
});

describe("ChatComposer", () => {
  it("submits on Enter, inserts newlines on Shift+Enter, and blocks empty or duplicate sends", async () => {
    let resolveSend: (accepted: boolean) => void = () => undefined;
    const onSend = vi.fn(() => new Promise<boolean>((resolve) => { resolveSend = resolve; }));
    render(<ChatComposer onSend={onSend} sending={false} />);
    const input = screen.getByLabelText("Message Gleska AI") as HTMLTextAreaElement;
    const sendButton = screen.getByLabelText("Send message") as HTMLButtonElement;

    expect(sendButton.disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "Line one" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(sendButton.disabled).toBe(false);

    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(sendButton);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("Line one", []);

    await act(async () => resolveSend(true));
    expect(input.value).toBe("");
  });

  it("disables the microphone with an explanation when the browser has no speech support", () => {
    render(<ChatComposer onSend={vi.fn()} sending={false} />);
    const mic = screen.getByLabelText("Start voice input") as HTMLButtonElement;
    expect(mic.disabled).toBe(true);
    expect(mic.title).toBe("Voice input isn't supported in this browser");
  });

  it("opens the attachment menu with image, file and camera options", () => {
    render(<ChatComposer onSend={vi.fn()} sending={false} />);
    fireEvent.click(screen.getByLabelText("Add photos and files"));
    expect(screen.getByRole("menuitem", { name: "Upload images" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Upload files" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Take photo" })).toBeTruthy();
  });

  it("uploads a selected document, shows it, and sends its file id", async () => {
    mocks.api.uploadFile.mockResolvedValue({
      id: "file-1",
      filename: "notes.txt",
      mime_type: "text/plain",
      size_bytes: 5,
      kind: "document",
      source: "upload",
      conversation_id: null,
      created_at: "2026-10-30T10:00:00Z",
      url: null,
    });
    const onSend = vi.fn().mockResolvedValue(true);
    const { container } = render(<ChatComposer onSend={onSend} sending={false} />);
    const fileInput = container.querySelector('input[accept=".pdf,.docx,.xlsx,.csv,.txt"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["hello"], "notes.txt", { type: "text/plain" })] } });

    await screen.findByText("5 B");
    fireEvent.click(screen.getByLabelText("Send message"));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("", [expect.objectContaining({ id: "file-1" })]));
    expect(mocks.api.uploadFile).toHaveBeenCalledWith(expect.any(File), "notes.txt", "upload", expect.any(Function), expect.any(AbortSignal));
  });
});

describe("ChatWorkspace", () => {
  function renderWorkspace(props: React.ComponentProps<typeof ChatWorkspace> = {}) {
    return render(
      <GeneralWorkProvider enabled>
        <ChatWorkspace {...props} />
      </GeneralWorkProvider>,
    );
  }

  it("shows the welcome screen, then creates a conversation and renders the reply", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    mocks.api.createConversation.mockResolvedValue(conversation);
    mocks.api.sendMessage.mockImplementation(async (_id: string, payload: { content: string; client_message_id: string }) =>
      exchangeFor(payload.content, payload.client_message_id),
    );

    renderWorkspace();
    expect(screen.getByText("Ready when you are.")).toBeTruthy();
    expect(screen.getByText("Ask anything. Research, create, analyse and get work done with Gleska AI.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Message Gleska AI"), { target: { value: "Prepare a business proposal" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    await screen.findByText("Proposal outline");
    expect(mocks.api.createConversation).toHaveBeenCalledWith(undefined);
    expect(mocks.api.sendMessage).toHaveBeenCalledWith(
      conversation.id,
      expect.objectContaining({ content: "Prepare a business proposal", attachment_ids: [] }),
    );
    expect(replaceState).toHaveBeenCalledWith(null, "", `/general-work/c/${conversation.id}`);
    expect(screen.getByRole("heading", { name: conversation.title })).toBeTruthy();
    expect(document.querySelector("table")).not.toBeNull();
  });

  it("keeps a failed message with a retry that reuses the same client message id", async () => {
    mocks.api.createConversation.mockResolvedValue(conversation);
    mocks.api.sendMessage
      .mockRejectedValueOnce(new Error("network"))
      .mockImplementation(async (_id: string, payload: { content: string; client_message_id: string }) =>
        exchangeFor(payload.content, payload.client_message_id),
      );

    renderWorkspace();
    fireEvent.change(screen.getByLabelText("Message Gleska AI"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    fireEvent.click(await screen.findByRole("button", { name: /Retry/ }));
    await screen.findByText("Proposal outline");
    const [first, second] = mocks.api.sendMessage.mock.calls.map((call) => call[1].client_message_id);
    expect(second).toBe(first);
    expect(mocks.api.createConversation).toHaveBeenCalledTimes(1);
  });

  it("loads an existing conversation and supports loading older messages", async () => {
    const older = exchangeFor("Earlier question", "c-1");
    mocks.api.getConversation.mockResolvedValue(conversation);
    mocks.api.listMessages
      .mockResolvedValueOnce({ messages: [{ ...older.user_message, id: "m3", content: "Latest question", created_at: "2026-10-30T10:05:00Z" }], has_more: true })
      .mockResolvedValueOnce({ messages: [{ ...older.user_message, id: "m1" }], has_more: false });

    renderWorkspace({ conversationId: conversation.id });
    await screen.findByText("Latest question");
    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
    await screen.findByText("Earlier question");
    expect(mocks.api.listMessages).toHaveBeenLastCalledWith(conversation.id, "2026-10-30T10:05:00Z", 30);
    expect(screen.queryByRole("button", { name: "Load earlier messages" })).toBeNull();
  });

  it("shows a not-found state for a conversation the user cannot access", async () => {
    mocks.api.getConversation.mockRejectedValue({ response: { status: 404 } });
    mocks.api.listMessages.mockRejectedValue({ response: { status: 404 } });
    renderWorkspace({ conversationId: conversation.id });
    await screen.findByText("This conversation doesn't exist or was deleted.");
  });
});
