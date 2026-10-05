import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { chatReducer, initialChatState } from "./chat";
import type { ClientMessage, ServerEvent } from "./types";

const RECONNECT_DELAY_MS = 2000;

/** セッションの WebSocket に接続し、受け取ったイベントをチャットの状態にまとめる */
export function useAgentSession(id: string, enabled: boolean) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${protocol}://${window.location.host}/ws/sessions/${encodeURIComponent(id)}`);
      socketRef.current = socket;
      socket.onopen = () => {
        dispatch({ type: "reset" });
        setConnected(true);
      };
      socket.onmessage = (e: MessageEvent<string>) => dispatch(JSON.parse(e.data) as ServerEvent);
      socket.onclose = () => {
        setConnected(false);
        if (!disposed) timer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };
    connect();

    return () => {
      disposed = true;
      clearTimeout(timer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [id, enabled]);

  const post = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  return {
    state,
    connected,
    send: useCallback((text: string) => post({ type: "user_message", text }), [post]),
    interrupt: useCallback(() => post({ type: "interrupt" }), [post]),
    respondApproval: useCallback(
      (id: string, approved: boolean, message?: string) => post({ type: "approval_response", id, approved, message }),
      [post],
    ),
  };
}
