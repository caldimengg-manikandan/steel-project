# Floating Messages Widget

A global, real-time floating messages widget integrated across the application with zero disruption to existing modules.

---

## 1. Architecture & Design

* **Isolated Frontend (`frontend/src/chat-widget/`)**:
  * `ChatWidgetLauncher.tsx`: Circular floating message trigger button fixed at bottom-right (`24px` offset, `z-index: 9999`) with unread count badge and toggle behavior.
  * `ChatWidgetPanel.tsx`: Zoho Cliq–style chat window (desktop `380×550px`, responsive full-screen on mobile, minimize, close, audio mute toggle).
  * `ConversationList.tsx`: Recent conversations list with last message snippet, timestamp, unread badge, and presence indicator.
  * `ConversationView.tsx`: Active chat thread with sender avatars, date separators, message bubbles, attachments, read receipts (`✓ / ✓✓`), and auto-scroll.
  * `NewChatModal.tsx`: Search colleagues by name, email, employee ID, role, or division to initiate 1-on-1 direct messages or multi-person group chats.
  * `MessageInput.tsx`: Input bar supporting Shift+Enter multi-line, Enter to send, inline emoji picker, and file/image uploader (up to 10MB).
  * `useChatSocket.ts`: Single Socket.IO connection per user session with Web Audio chime, desktop browser notifications, presence, and typing indicators.
  * `ChatWidget.css`: Completely scoped styles using the `.cw-*` namespace to prevent CSS bleed.

* **Isolated Backend (`backend/src/chat/`)**:
  * `models/Conversation.js`: Multi-tenant scoped conversations (direct and group) with participant metadata, last message, and unread counts.
  * `models/ChatMessage.js`: Message records with text content, attachments, and read receipts.
  * `controllers/chatController.js`: Handlers for conversations, paginated messages, user search, attachment uploads, rate limiting, and sanitization.
  * `routes/chatRoutes.js`: Express routes protected by JWT auth (`verifyToken`).
  * `socket/chatSocket.js`: Real-time WebSocket server using Socket.IO with automatic HTTP long-polling fallback, room-based dispatch, typing indicators, and presence tracking.

---

## 2. Environment Variables & Feature Flags

| Variable | Location | Default | Description |
|---|---|---|---|
| `ENABLE_CHAT_WIDGET` | Backend `.env` | `true` | When set to `false`, the chat router and Socket.IO server are completely deactivated without any code changes. |
| `VITE_ENABLE_CHAT_WIDGET` | Frontend `.env` | `true` | When set to `false`, the frontend widget renders `null` and consumes zero resources. |
| `VITE_SOCKET_URL` | Frontend `.env` | Current origin (proxied) | Override for dedicated WebSocket server URL if hosted on a separate domain. |

---

## 3. Database Indexes Migration

To ensure optimal query performance for conversations and messages, run:

```bash
cd backend
node src/chat/scripts/migrateChatIndexes.js
```

---

## 4. Single-Point Mount Diff

### Frontend (`frontend/src/App.tsx`):
```diff
+import { lazy, Suspense } from 'react';
+const ChatWidgetLauncher = lazy(() => import('./chat-widget/ChatWidgetLauncher'));

...
             <Route path="*" element={<Navigate to="/login" replace />} />
           </Routes>
+          <Suspense fallback={null}>
+            <ChatWidgetLauncher />
+          </Suspense>
         </BrowserRouter>
```

### Backend (`backend/src/app.js`):
```diff
 app.use('/api/error-log', require('./routes/errorLogRoutes'));
+if (process.env.ENABLE_CHAT_WIDGET !== 'false') app.use('/api/chat', require('./chat').router);

...
     const server = app.listen(PORT, async () => {
+        if (process.env.ENABLE_CHAT_WIDGET !== 'false') require('./chat').initSocket(server);
         console.log(`\n[SERVER] Steel Detailing DMS API running on http://localhost:${PORT}`);
```

---

## 5. How to Disable or Remove

* **To Disable Temporarily:** Set `ENABLE_CHAT_WIDGET=false` in backend environment and `VITE_ENABLE_CHAT_WIDGET=false` in frontend environment.
* **To Remove Permanently:** 
  1. Remove the import and mount in `frontend/src/App.tsx` and `backend/src/app.js`.
  2. Delete folders `frontend/src/chat-widget/` and `backend/src/chat/`.
