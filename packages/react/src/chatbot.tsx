/**
 * `@jects/react/chatbot` — isolated React binding for the Jects Chatbot engine.
 *
 * Importing this entry pulls in ONLY `@jects/chatbot` (plus the shared factory and
 * React), never any sibling engine.
 */
import { Chatbot, type ChatbotConfig, type ChatbotEvents } from '@jects/chatbot';
import { createComponent } from './factory.js';

export const JectsChatbot = createComponent<Chatbot, ChatbotConfig, ChatbotEvents>(Chatbot);
export type { ChatbotConfig, ChatbotEvents };
