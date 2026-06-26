/** Route: chatbot. */
import { el, card } from '../shell/dom.js';
import { section, Chatbot } from '../shell/registry.js';

export function register() {
  section(
    'chatbot',
    'Chatbot',
    'An LLM-agnostic chat UI — avatars, names, timestamps, copy + clear actions, suggested replies, and mock streaming Markdown (headings · bold · fenced code · lists).',
    (grid) => {
      grid.appendChild(card('Chatbot (chat UI, mock provider)', (h) => {
        const host = el('div', { style: 'height:var(--g-page-host);width:100%' });
        h.appendChild(host);
        const avatar = (bg, ch) =>
          'data:image/svg+xml;utf8,' +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">` +
              `<rect width="40" height="40" rx="20" fill="${bg}"/>` +
              `<text x="20" y="26" font-family="system-ui" font-size="17" fill="white" text-anchor="middle">${ch}</text></svg>`,
          );
        async function* mockStream(text) {
          const reply = `You said: **${text}**.\n\n### What I can do\n\n- stream token by token\n- render \`markdown\`, including fenced code:\n\n\`\`\`js\nchat.onSend = (t) => provider.stream(t);\n\`\`\`\n\n- show suggested replies`;
          for (const word of reply.split(/(\s+)/)) {
            await new Promise((r) => setTimeout(r, 20));
            yield word;
          }
        }
        new Chatbot(host, {
          title: 'Assistant',
          placeholder: 'Ask me anything…',
          userName: 'You',
          assistantName: 'Jects Bot',
          userAvatar: avatar('oklch(0.55 0.13 250)', 'Y'),
          assistantAvatar: avatar('oklch(0.6 0.15 200)', 'J'),
          showAvatars: true,
          showTimestamps: true,
          copyable: true,
          clearable: true,
          suggestions: ['What can you do?', 'Show me a code block', 'Summarize this page'],
          messages: [
            { role: 'assistant', text: 'Hi! I am a demo bot. How can I help you today?' },
            { role: 'user', text: 'What is this gallery?' },
            { role: 'assistant', text: "It's a live showcase of the **Jects UI** component library — every card is a real, interactive widget." },
          ],
          onSend: (text) => mockStream(text),
        });
        h.appendChild(el('div', { class: 'g-note', text: 'Avatars + names + timestamps on every turn; hover a message for the copy action, or Clear the transcript from the toolbar. Type and press Enter (Shift+Enter for a newline) — the mock provider streams a Markdown reply (heading, bold, a fenced code block, and a list) token by token. Swap onSend for OpenAI / Anthropic / a local model.' }));
      }, { block: true }));
    },
    { wide: true },
  );
}
