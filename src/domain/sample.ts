import type { GeneratedCard } from '../shared/generation';
import type { Card, Deck } from './types';
import { createCards, newId } from './factory';

export const SAMPLE_SOURCE = `기억의 과학 — 왜 자투리 복습이 통할까?

에빙하우스의 망각곡선: 독일 심리학자 헤르만 에빙하우스는 무의미 음절을 외운 뒤 시간이 지남에 따라 얼마나 잊는지 측정했다. 학습 직후 망각이 가장 빠르게 일어나며, 하루가 지나면 상당 부분을 잊는다.

간격 반복(Spaced Repetition): 같은 내용을 한 번에 몰아서 보는 것(집중 학습)보다, 시간 간격을 두고 여러 번 나누어 복습하는 것이 장기 기억에 더 효과적이다. 이를 간격 효과(spacing effect)라고 한다. 복습 간격은 기억이 단단해질수록 점점 늘린다(예: 1일 → 3일 → 7일 → 14일).

인출 연습(Retrieval Practice): 내용을 다시 읽는 것보다 스스로 떠올려 보는 시험이 기억을 더 강화한다. 이를 시험 효과(testing effect)라고 한다. 틀리더라도 떠올리려 시도한 뒤 정답을 확인하면 효과가 있다.

교차 학습(Interleaving): 한 주제만 연달아 공부하기보다 여러 주제를 섞어서 공부하면 개념을 구별하는 능력이 좋아진다.

수면과 기억: 잠자는 동안 낮에 배운 내용이 정리되어 장기 기억으로 굳어진다(기억 공고화).`;

const SAMPLE_CARDS: GeneratedCard[] = [
  {
    type: 'multiple_choice',
    question: '망각곡선을 처음 실험으로 측정한 사람은?',
    options: ['헤르만 에빙하우스', '장 피아제', '이반 파블로프', '지그문트 프로이트'],
    answer: '헤르만 에빙하우스',
    explanation: '에빙하우스는 무의미 음절을 외운 뒤 시간에 따른 망각을 측정했어요.',
    concept: '망각곡선',
  },
  {
    type: 'ox',
    question: '망각은 학습 직후에 가장 빠르게 일어난다.',
    answer: 'O',
    explanation: '망각곡선은 처음에 가파르게 떨어지고 시간이 지날수록 완만해져요.',
    concept: '망각곡선',
  },
  {
    type: 'flashcard',
    question: '간격 효과 (spacing effect)',
    answer: '몰아서 공부하는 것보다 시간 간격을 두고 나눠서 복습할 때 더 오래 기억하는 현상',
    concept: '간격 반복',
  },
  {
    type: 'multiple_choice',
    question: '간격 반복에서 복습 간격은 보통 어떻게 바뀌나요?',
    options: ['기억이 단단해질수록 늘어난다', '항상 하루로 같다', '점점 줄어든다', '무작위로 정한다'],
    answer: '기억이 단단해질수록 늘어난다',
    explanation: '1일 → 3일 → 7일 → 14일처럼 점점 늘려요. 퀴즈미도 이 방식으로 복습 날짜를 정해요.',
    concept: '간격 반복',
  },
  {
    type: 'ox',
    question: '다시 읽기가 스스로 떠올려 보는 것보다 기억에 더 효과적이다.',
    answer: 'X',
    explanation: '떠올려 보는 인출 연습(시험 효과)이 다시 읽기보다 효과적이에요.',
    concept: '인출 연습',
  },
  {
    type: 'short_answer',
    question: '시험을 보는 것 자체가 기억을 강화하는 현상을 무슨 효과라고 할까요?',
    answer: '시험 효과',
    acceptedAnswers: ['testing effect', '테스트 효과'],
    explanation: '떠올리는 과정이 기억을 단단하게 만들어요. 틀려도 효과가 있어요!',
    concept: '인출 연습',
  },
  {
    type: 'flashcard',
    question: '교차 학습 (Interleaving)',
    answer: '여러 주제를 섞어서 공부하는 방법. 개념을 서로 구별하는 능력이 좋아진다.',
    concept: '교차 학습',
  },
  {
    type: 'ox',
    question: '틀린 문제는 떠올리려 시도한 의미가 전혀 없다.',
    answer: 'X',
    explanation: '틀려도 떠올리려 애쓴 뒤 정답을 확인하면 기억에 도움이 돼요.',
    concept: '인출 연습',
  },
  {
    type: 'multiple_choice',
    question: '잠자는 동안 배운 내용이 장기 기억으로 굳어지는 과정은?',
    options: ['기억 공고화', '간섭', '망각', '부호화 실패'],
    answer: '기억 공고화',
    explanation: '수면 중에 낮에 배운 내용이 정리되어 장기 기억이 돼요.',
    concept: '기억 공고화',
  },
  {
    type: 'flashcard',
    question: '인출 연습 (Retrieval Practice)',
    answer: '내용을 다시 읽는 대신 스스로 떠올려 보는 학습법',
    concept: '인출 연습',
  },
];

export function createSampleDeck(now = Date.now()): { deck: Deck; cards: Card[] } {
  const deck: Deck = {
    id: newId(),
    title: '기억의 과학 (샘플)',
    emoji: '🧠',
    color: 'mint',
    sourceText: SAMPLE_SOURCE,
    createdAt: now,
    updatedAt: now,
  };
  return { deck, cards: createCards(deck.id, SAMPLE_CARDS, 'sample', now) };
}
