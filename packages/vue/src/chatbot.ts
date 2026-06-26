/**
 * `@jects/vue/chatbot` — typed Vue 3 binding for {@link Chatbot} only.
 *
 * Imports only the shared factory and the `@jects/chatbot` engine.
 */
import { createComponent } from './factory.js';
import { Chatbot, type ChatbotConfig, type ChatbotEvents } from '@jects/chatbot';

export const JectsChatbot = createComponent<Chatbot, ChatbotConfig, ChatbotEvents>(Chatbot);

export type { ChatbotConfig, ChatbotEvents };
