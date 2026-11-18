import {
  CARD_TYPES,
  CARD_TYPE_LABELS,
  DIFFICULTIES,
  MAX_AVOID_ITEMS,
  MAX_CARDS_PER_REQUEST,
  MAX_REMIX_SEEDS,
  MAX_SOURCE_CHARS_PER_REQUEST,
  MIN_SOURCE_CHARS,
  type CardType,
  type Difficulty,
  type GenerateRequest,
  type RemixSeed,
} from '../src/shared/generation.js';

function cleanStrings(value: unknown, limit: number, maxChars: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .slice(0, limit)
    .map(v => v.trim().slice(0, maxChars));
}

export function parseGenerateRequest(body: unknown): GenerateRequest | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const opts = (b.options ?? {}) as Record<string, unknown>;

  const mode = b.mode;
  if (mode !== 'deck' && mode !== 'more' && mode !== 'remix') return 'mode가 올바르지 않습니다.';

  const difficulty = opts.difficulty as Difficulty;
  if (!DIFFICULTIES.includes(difficulty)) return '난이도가 올바르지 않습니다.';

  const count = opts.count;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_CARDS_PER_REQUEST) {
    return `카드 수는 1~${MAX_CARDS_PER_REQUEST} 사이여야 합니다.`;
  }

  const rawTypes = Array.isArray(opts.types) ? opts.types : [];
  const types = CARD_TYPES.filter(t => rawTypes.includes(t));
  if (types.length === 0) return '문제 유형을 하나 이상 선택해주세요.';

  const sourceText = typeof b.sourceText === 'string' ? b.sourceText.trim() : '';
  if (sourceText.length > MAX_SOURCE_CHARS_PER_REQUEST) return '학습 자료가 한 번에 처리할 수 있는 길이를 넘었습니다.';

  const avoid = cleanStrings(b.avoid, MAX_AVOID_ITEMS, 200);

  let seeds: RemixSeed[] = [];
  if (mode === 'remix') {
    seeds = (Array.isArray(b.seeds) ? b.seeds : [])
      .slice(0, MAX_REMIX_SEEDS)
      .map(s => s as Record<string, unknown>)
      .filter(s => typeof s.question === 'string' && typeof s.answer === 'string')
      .map(s => ({
        question: String(s.question).slice(0, 400),
        answer: String(s.answer).slice(0, 300),
        concept: typeof s.concept === 'string' ? s.concept.slice(0, 30) : undefined,
      }));
    if (seeds.length === 0) return '리믹스할 카드가 없습니다.';
  } else if (sourceText.length < MIN_SOURCE_CHARS) {
    return '학습 자료가 너무 짧습니다.';
  }

  return { mode, sourceText, options: { difficulty, count, types }, avoid, seeds };
}

const DIFFICULTY_GUIDES: Record<Difficulty, string> = {
  easy: '자료에 명시된 정의·사실을 그대로 확인하는 문제. 오답 보기는 명확하게 틀린 것으로.',
  medium: '개념을 이해했는지 확인하는 문제. 자료의 표현을 그대로 베끼지 말고 바꿔서 물을 것.',
  hard: '개념 간 비교·적용·추론이 필요한 문제. 오답 보기는 그럴듯해서 헷갈리도록.',
};

const TYPE_RULES: Record<CardType, string> = {
  multiple_choice: '- multiple_choice: options에 보기 4개(서로 다르게), answer는 그중 하나와 글자까지 정확히 일치. 정답 위치를 매번 다르게.',
  ox: '- ox: question은 참/거짓을 판단할 수 있는 한 문장 진술, answer는 "O" 또는 "X". O와 X가 한쪽으로 몰리지 않게.',
  short_answer: '- short_answer: 한두 단어로 답할 수 있는 질문. answer는 가장 대표적인 정답, accepted_answers에 동의어·영문 표기 등(최대 3개)',
  flashcard: '- flashcard: question에 용어나 개념(앞면, 짧게), answer에 그 정의나 설명(뒷면, 한두 문장)',
};

const COMMON_RULES = `- 문제와 해설은 학습 자료와 같은 언어로 작성 (자료가 영어면 영어)
- 자료에 없는 내용을 지어내지 말 것
- 폰 화면에서 읽기 좋게 문제는 짧고 명확하게 (가급적 80자 이내)
- explanation: 왜 그게 정답인지 한두 문장
- concept: 이 문제가 확인하는 핵심 개념 이름 (2~15자 명사구, 예: "명반응"). 같은 개념은 항상 같은 표현으로 쓸 것`;

function typeSection(types: CardType[]) {
  const names = types.map(t => CARD_TYPE_LABELS[t]).join(', ');
  const mix = types.length > 1 ? ' (선택된 유형을 골고루 섞을 것)' : '';
  return `유형: ${names}${mix}\n${types.map(t => TYPE_RULES[t]).join('\n')}`;
}

function avoidSection(avoid: string[] = []) {
  if (!avoid.length) return '';
  return `\n[이미 만든 문제] — 아래와 같거나 거의 같은 문제는 만들지 말고, 다루지 않은 내용을 우선할 것\n${avoid.map(q => `- ${q}`).join('\n')}\n`;
}

export function buildPrompt(req: GenerateRequest) {
  const { mode, options } = req;

  if (mode === 'remix') {
    const seeds = (req.seeds ?? [])
      .map((s, i) => `${i + 1}. [개념: ${s.concept || '미상'}] Q: ${s.question} / A: ${s.answer}`)
      .join('\n');
    return `당신은 학습자가 자주 틀리는 문제를 다른 각도에서 다시 물어보는 튜터입니다.
아래 [자주 틀린 문제]와 같은 개념을 확인하되, 질문 방식·관점·예시를 바꾼 새 문제를 정확히 ${options.count}개 만드세요.
원래 문제의 문장이나 보기를 그대로 재사용하지 말 것. 정의를 묻던 문제는 적용·예시·반례로, 예시를 묻던 문제는 정의·비교로 바꾸는 식으로.
난이도: ${DIFFICULTY_GUIDES[options.difficulty]}
${typeSection(options.types)}
${COMMON_RULES}
${avoidSection(req.avoid)}
[자주 틀린 문제]
${seeds}
${req.sourceText ? `\n[참고 학습자료]\n${req.sourceText}` : ''}`;
  }

  const head = mode === 'more'
    ? `아래 [학습자료]로 이미 문제를 만들었습니다. 기존 문제와 겹치지 않는 새 문제를 정확히 ${options.count}개 더 만드세요.`
    : `아래 [학습자료]를 읽고 핵심 개념을 확인할 수 있는 문제를 정확히 ${options.count}개 만드세요.
title: 이 자료의 주제를 나타내는 짧은 덱 이름 (15자 이내, 예: "광합성 핵심"), emoji: 주제에 어울리는 이모지 1개`;

  return `당신은 학습 자료를 바탕으로 모바일 복습용 퀴즈 카드를 만드는 도우미입니다.
${head}
난이도: ${DIFFICULTY_GUIDES[options.difficulty]}
${typeSection(options.types)}
${COMMON_RULES}
${avoidSection(req.avoid)}
[학습자료]
${req.sourceText}`;
}

export function responseSchema(req: GenerateRequest) {
  const card = {
    type: 'OBJECT',
    properties: {
      type: { type: 'STRING', enum: req.options.types },
      question: { type: 'STRING' },
      options: { type: 'ARRAY', items: { type: 'STRING' } },
      answer: { type: 'STRING' },
      accepted_answers: { type: 'ARRAY', items: { type: 'STRING' } },
      explanation: { type: 'STRING' },
      concept: { type: 'STRING' },
    },
    required: ['type', 'question', 'answer', 'explanation', 'concept'],
  };
  const withTitle = req.mode === 'deck';
  return {
    type: 'OBJECT',
    properties: {
      ...(withTitle ? { title: { type: 'STRING' }, emoji: { type: 'STRING' } } : {}),
      cards: { type: 'ARRAY', items: card },
    },
    required: withTitle ? ['title', 'emoji', 'cards'] : ['cards'],
  };
}
