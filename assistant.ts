import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';
import { requireAuth, type AuthedRequest } from './server/middleware.ts';
import { createRateLimiter } from './server/security.ts';

export const assistantRouter = Router();
const aiLimiter = createRateLimiter(60_000, 20);

function getFallbackAnswer(question: string): { answer: string; suggestedRoute: string } {
  const q = question.toLowerCase();
  if (q.includes('group') && (q.includes('create') || q.includes('make') || q.includes('new'))) {
    return {
      answer:
        'Go to My Groups from the left sidebar and click "New Group". Choose a name, category (e.g., Friends, Travel, Home), and optionally add member emails.',
      suggestedRoute: '/groups',
    };
  }
  if (q.includes('invite') || q.includes('qr')) {
    return {
      answer:
        'Open any group workspace and select the "Members & Invites" tab. You can copy a secure invite link or display a scannable Group QR code. For payments, open Settlements and click "Pay via UPI QR" to generate a UPI payment QR and submit your UTR reference.',
      suggestedRoute: '/groups',
    };
  }
  if (q.includes('item') || q.includes('split') || q.includes('tea') || q.includes('coffee') || q.includes('expense')) {
    return {
      answer:
        'Click "Add Expense", pick your group and who paid, then select "Item-wise" split. Add each bill item (like Tea ₹100 or Coffee ₹120), check only the members who consumed that item, and add any shared tax or discount. SettleUp calculates every share in exact integer paise before saving.',
      suggestedRoute: '/add-expense',
    };
  }
  if (q.includes('owe') || q.includes('balance') || q.includes('why')) {
    return {
      answer:
        'Your net balance equals Total Paid minus Total Owed across your groups, adjusted by confirmed settlements. Open the Balances page to see "People I Owe", "People Who Owe Me", and the simplified minimum-transfer plan.',
      suggestedRoute: '/balances',
    };
  }
  if (q.includes('settle') || q.includes('pay')) {
    return {
      answer:
        'Visit Settlements (or a Group Workspace Balances tab) to see suggested transfers. Pay via UPI QR or cash, record your transaction reference, and once the recipient confirms receipt, your balance updates automatically.',
      suggestedRoute: '/settlements',
    };
  }
  return {
    answer:
      'SettleUp helps you create groups, log expenses using 5 split modes (including item-wise bills), inspect simplified balances, and confirm UPI settlements. Use the sidebar to jump to Dashboard, Groups, Add Expense, Balances, Settlements, or Analytics.',
    suggestedRoute: '/dashboard',
  };
}

assistantRouter.post('/', requireAuth, aiLimiter, async (req: AuthedRequest, res) => {
  const { question } = req.body as { question?: string };
  const cleanQ = (question ?? '').trim();
  if (!cleanQ || cleanQ.length > 500) {
    res.status(400).json({ error: 'Please ask a concise question (1–500 characters).' });
    return;
  }

  const fallback = getFallbackAnswer(cleanQ);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    res.json({ answer: fallback.answer, suggestedRoute: fallback.suggestedRoute, source: 'help-centre' });
    return;
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const systemInstruction = `You are the SettleUp in-app Help Assistant for ${req.user!.fullName}.
Answer questions clearly in 2-4 concise sentences in friendly, beginner-accessible English.
Explain how to use SettleUp features:
- Creating groups & generating secure invite links/QR codes (My Groups -> Group Workspace -> Members & Invites).
- Adding expenses with 5 split modes: Equal, Exact, Percentage, Shares, and Item-wise (Add Expense -> Item-wise lets you assign specific consumers per item plus tax/tip/discount in exact integer paise).
- Understanding balances: Net Balance = Total Paid - Total Owed + Confirmed Settlements Paid - Confirmed Settlements Received. SettleUp uses greedy min-cash-flow simplification to minimize transfers.
- Recording settlements & UPI QR: Generate UPI payment QR, submit UTR/reference, and wait for recipient confirmation (QR scan alone never auto-settles).
Never invent user financial numbers or expose private data.`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: cleanQ,
      config: {
        systemInstruction,
      },
    });

    const text = response.text?.trim() || fallback.answer;
    res.json({
      answer: text,
      suggestedRoute: fallback.suggestedRoute,
      source: 'gemini',
    });
  } catch {
    res.json({
      answer: fallback.answer,
      suggestedRoute: fallback.suggestedRoute,
      source: 'help-centre',
    });
  }
});
