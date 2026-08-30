/*
 * Ygeia — the daily question and the daily fact.
 *
 * A small hand-written bank rather than a generated one. Everything in here is checkable:
 * the maths questions have worked answers, the grammar questions have a stated rule, and
 * the facts are the kind that survive being looked up. A study aid that quietly teaches
 * something false is worse than no study aid.
 *
 * Levels follow the shape of the SAT rather than a school year, so they travel:
 *   foundation  early practice — arithmetic, fractions, basic grammar
 *   standard    the bulk of the real test
 *   advanced    the harder end of each section
 *
 * Question shape:
 *   { id, subject, level, question, choices: [], answer: index, explain, source? }
 *
 * `id` is permanent. Answers are stored against it, so renumbering the array is safe but
 * changing an id orphans someone's history.
 */
(function (V) {
  'use strict';

  const SUBJECTS = [
    { value: 'math', label: 'Math' },
    { value: 'ela', label: 'Reading & Writing' },
    { value: 'science', label: 'Science' },
    { value: 'history', label: 'History' },
  ];

  const LEVELS = [
    { value: 'foundation', label: 'Foundation', note: 'Building the basics' },
    { value: 'standard', label: 'Standard', note: 'Typical SAT difficulty' },
    { value: 'advanced', label: 'Advanced', note: 'The harder end' },
  ];

  const QUESTIONS = [
    // ---- Math: foundation ---------------------------------------------------
    { id: 'm-f-1', subject: 'math', level: 'foundation',
      question: 'If 3x + 7 = 22, what is x?',
      choices: ['3', '5', '7', '15'], answer: 1,
      explain: 'Subtract 7 from both sides: 3x = 15. Divide by 3: x = 5.' },
    { id: 'm-f-2', subject: 'math', level: 'foundation',
      question: 'What is 40% of 250?',
      choices: ['80', '100', '110', '125'], answer: 1,
      explain: '40% is 0.4, and 0.4 × 250 = 100. Or: 10% is 25, so 40% is 4 × 25 = 100.' },
    { id: 'm-f-3', subject: 'math', level: 'foundation',
      question: 'A shirt costs $30 after a 25% discount. What was the original price?',
      choices: ['$37.50', '$40', '$45', '$22.50'], answer: 1,
      explain: '$30 is 75% of the original. Original = 30 ÷ 0.75 = $40. Adding 25% back to ' +
               '$30 gives $37.50, which is the classic trap — a percentage off and the same ' +
               'percentage on are not inverses.' },
    { id: 'm-f-4', subject: 'math', level: 'foundation',
      question: 'What is the slope of the line through (2, 3) and (6, 11)?',
      choices: ['1/2', '2', '4', '8'], answer: 1,
      explain: 'Slope = (11 − 3) ÷ (6 − 2) = 8 ÷ 4 = 2.' },

    // ---- Math: standard -----------------------------------------------------
    { id: 'm-s-1', subject: 'math', level: 'standard',
      question: 'If f(x) = 2x² − 3x + 1, what is f(−2)?',
      choices: ['3', '11', '15', '−1'], answer: 2,
      explain: 'f(−2) = 2(−2)² − 3(−2) + 1 = 2(4) + 6 + 1 = 8 + 6 + 1 = 15. The sign of the ' +
               'middle term is where most errors happen: −3 × −2 is +6.' },
    { id: 'm-s-2', subject: 'math', level: 'standard',
      question: 'A circle has equation (x − 3)² + (y + 2)² = 25. What is its centre?',
      choices: ['(3, −2)', '(−3, 2)', '(3, 2)', '(−3, −2)'], answer: 0,
      explain: 'In (x − h)² + (y − k)² = r², the centre is (h, k). Here y + 2 is y − (−2), ' +
               'so k = −2 and the centre is (3, −2). The radius is √25 = 5.' },
    { id: 'm-s-3', subject: 'math', level: 'standard',
      question: 'The average of 5 numbers is 12. If a sixth number is added and the average ' +
                'becomes 13, what is the sixth number?',
      choices: ['13', '15', '18', '20'], answer: 2,
      explain: 'Five numbers averaging 12 sum to 60. Six averaging 13 sum to 78. The sixth ' +
               'number is 78 − 60 = 18. Averages are almost always easier as sums.' },
    { id: 'm-s-4', subject: 'math', level: 'standard',
      question: 'If 2^x = 32, what is x?',
      choices: ['4', '5', '6', '16'], answer: 1,
      explain: '2⁵ = 32, so x = 5.' },

    // ---- Math: advanced -----------------------------------------------------
    { id: 'm-a-1', subject: 'math', level: 'advanced',
      question: 'If x + 1/x = 4, what is x² + 1/x²?',
      choices: ['14', '16', '18', '12'], answer: 0,
      explain: 'Square both sides: (x + 1/x)² = x² + 2 + 1/x² = 16. So x² + 1/x² = 14. ' +
               'The cross terms give exactly 2, which is what makes this work without ' +
               'ever solving for x.' },
    { id: 'm-a-2', subject: 'math', level: 'advanced',
      question: 'A right triangle has legs of 6 and 8. What is the length of the altitude ' +
                'drawn to the hypotenuse?',
      choices: ['4.8', '5', '5.6', '7'], answer: 0,
      explain: 'The hypotenuse is 10. Area computed two ways: ½(6)(8) = ½(10)(h), so ' +
               '24 = 5h and h = 4.8.' },
    { id: 'm-a-3', subject: 'math', level: 'advanced',
      question: 'How many distinct real solutions does x² − 6x + 9 = 0 have?',
      choices: ['0', '1', '2', 'Infinitely many'], answer: 1,
      explain: 'The discriminant is (−6)² − 4(1)(9) = 36 − 36 = 0, so there is exactly one ' +
               'distinct real root. It factors as (x − 3)², giving x = 3 as a repeated root.' },

    // ---- Reading & Writing: foundation --------------------------------------
    { id: 'e-f-1', subject: 'ela', level: 'foundation',
      question: 'Choose the correct word: "The team celebrated ___ victory."',
      choices: ['they\'re', 'their', 'there', 'theirs'], answer: 1,
      explain: '"Their" is the possessive. "They\'re" is "they are", and "there" is a place.' },
    { id: 'e-f-2', subject: 'ela', level: 'foundation',
      question: 'Which sentence is punctuated correctly?',
      choices: [
        'It was raining, we stayed inside.',
        'It was raining we stayed inside.',
        'It was raining, so we stayed inside.',
        'It was raining; so we stayed inside.',
      ], answer: 2,
      explain: 'Two independent clauses need a coordinating conjunction after the comma. ' +
               'The first is a comma splice; the second is a run-on. A semicolon can join ' +
               'them, but not alongside "so".' },
    { id: 'e-f-3', subject: 'ela', level: 'foundation',
      question: 'What does "concise" mean?',
      choices: ['Detailed', 'Brief and clear', 'Confusing', 'Formal'], answer: 1,
      explain: 'Concise means saying something in few words without losing the meaning.' },

    // ---- Reading & Writing: standard ----------------------------------------
    { id: 'e-s-1', subject: 'ela', level: 'standard',
      question: 'Choose the correct verb: "Neither the manager nor the employees ___ aware ' +
                'of the change."',
      choices: ['was', 'were', 'is', 'has been'], answer: 1,
      explain: 'With "neither…nor", the verb agrees with the nearer subject. "Employees" is ' +
               'plural, so "were". Swap the order and it would be "was".' },
    { id: 'e-s-2', subject: 'ela', level: 'standard',
      question: 'Which revision best fixes the dangling modifier? "Walking through the ' +
                'park, the flowers were beautiful."',
      choices: [
        'Walking through the park, the beautiful flowers appeared.',
        'The flowers were beautiful, walking through the park.',
        'Walking through the park, I thought the flowers were beautiful.',
        'While walking, the flowers through the park were beautiful.',
      ], answer: 2,
      explain: 'The opening phrase must describe the subject that follows it. As written, ' +
               'the flowers are doing the walking. Naming a person who can walk fixes it.' },
    { id: 'e-s-3', subject: 'ela', level: 'standard',
      question: 'In context, "The evidence was damning" most nearly means the evidence was:',
      choices: ['Unclear', 'Strongly incriminating', 'Irrelevant', 'Disputed'], answer: 1,
      explain: '"Damning" means it strongly establishes guilt or fault.' },

    // ---- Reading & Writing: advanced ----------------------------------------
    { id: 'e-a-1', subject: 'ela', level: 'advanced',
      question: 'Which sentence uses the semicolon correctly?',
      choices: [
        'She had one goal; to finish the race.',
        'The results were clear; the treatment worked.',
        'Although it rained; the match continued.',
        'He packed a bag; and left.',
      ], answer: 1,
      explain: 'A semicolon joins two independent clauses. Only the second option has a ' +
               'complete sentence on each side. The first needs a colon, the third a comma, ' +
               'and the fourth should drop either the semicolon or the "and".' },
    { id: 'e-a-2', subject: 'ela', level: 'advanced',
      question: 'An author who describes a policy as "ostensibly generous" is signalling that ' +
                'the policy is:',
      choices: [
        'Genuinely generous',
        'Generous in appearance but perhaps not in fact',
        'Unusually expensive',
        'Widely admired',
      ], answer: 1,
      explain: '"Ostensibly" flags a gap between how something appears and how it is. It is ' +
               'one of the most reliable tone markers in SAT reading — it almost always ' +
               'precedes a challenge to the appearance.' },

    // ---- Science ------------------------------------------------------------
    { id: 's-f-1', subject: 'science', level: 'foundation',
      question: 'Which part of a plant cell carries out photosynthesis?',
      choices: ['Nucleus', 'Mitochondrion', 'Chloroplast', 'Ribosome'], answer: 2,
      explain: 'Chloroplasts hold chlorophyll, which captures light energy. Mitochondria ' +
               'release energy from sugar — plants have both.' },
    { id: 's-s-1', subject: 'science', level: 'standard',
      question: 'In an experiment, which variable does the researcher deliberately change?',
      choices: ['Dependent', 'Independent', 'Controlled', 'Confounding'], answer: 1,
      explain: 'The independent variable is the one manipulated. The dependent variable is ' +
               'what you measure in response, and controlled variables are held constant.' },
    { id: 's-s-2', subject: 'science', level: 'standard',
      question: 'What does a pH of 3 indicate compared with a pH of 5?',
      choices: [
        'Slightly more acidic',
        '2 times more acidic',
        '100 times more acidic',
        'Less acidic',
      ], answer: 2,
      explain: 'pH is logarithmic — each unit is a tenfold change in hydrogen ion ' +
               'concentration. Two units is 10² = 100 times.' },
    { id: 's-a-1', subject: 'science', level: 'advanced',
      question: 'A study finds ice cream sales correlate with drowning deaths. The best ' +
                'explanation is:',
      choices: [
        'Ice cream impairs swimming',
        'Drowning causes ice cream sales',
        'A third factor — hot weather — drives both',
        'The correlation must be a calculation error',
      ], answer: 2,
      explain: 'This is the textbook confounding variable. Hot weather independently raises ' +
               'both ice cream sales and time spent in water. A real correlation with no ' +
               'causal link between the two variables is entirely possible.' },

    // ---- History ------------------------------------------------------------
    { id: 'h-f-1', subject: 'history', level: 'foundation',
      question: 'The Magna Carta was signed in which year?',
      choices: ['1066', '1215', '1348', '1492'], answer: 1,
      explain: 'King John sealed it at Runnymede in 1215. 1066 is the Norman Conquest, ' +
               '1348 the Black Death reaching England, and 1492 Columbus\'s first voyage.' },
    { id: 'h-s-1', subject: 'history', level: 'standard',
      question: 'The Industrial Revolution began in which country?',
      choices: ['France', 'Britain', 'Germany', 'The United States'], answer: 1,
      explain: 'It began in Britain around the 1760s — coal, colonial capital, and a ' +
               'concentration of textile innovation put it first by several decades.' },
    { id: 'h-s-2', subject: 'history', level: 'standard',
      question: 'A primary source is best described as:',
      choices: [
        'A textbook summarising events',
        'A record created at the time by someone present',
        'The most reliable account available',
        'A peer-reviewed article',
      ], answer: 1,
      explain: 'Primary means direct and contemporaneous — a letter, a photograph, a treaty. ' +
               'It does not mean accurate: an eyewitness can be mistaken or lying, which is ' +
               'exactly why sources get cross-examined.' },
    { id: 'h-a-1', subject: 'history', level: 'advanced',
      question: 'The term "Columbian Exchange" refers to:',
      choices: [
        'A trade agreement between Spain and Portugal',
        'The transfer of crops, animals and disease between the Americas and Eurasia',
        'The route Columbus sailed in 1492',
        'A 19th-century financial market',
      ], answer: 1,
      explain: 'Coined by historian Alfred Crosby in 1972. Its largest effect was ' +
               'demographic: Eurasian diseases, especially smallpox, killed a very large ' +
               'proportion of Indigenous American populations within a century.' },
  ];

  /**
   * One fact a day. Short, specific, and the sort of thing that is actually true — no
   * "we only use 10% of our brains".
   */
  const FACTS = [
    { subject: 'math', text: 'In any group of 23 people there is a better-than-even chance two share a birthday. It feels wrong because you are counting the 253 possible pairs, not the 23 people.' },
    { subject: 'math', text: 'Zero was used as a placeholder in Babylonian arithmetic, but treating it as a number you can compute with comes from 7th-century India, with Brahmagupta.' },
    { subject: 'math', text: 'There are more ways to shuffle a standard deck of cards than there are atoms on Earth. 52! is about 8 × 10⁶⁷.' },
    { subject: 'math', text: 'A sheet of paper folded 42 times would reach the Moon. Doubling 0.1 mm forty-two times gives about 440,000 km — you cannot actually do it, but the arithmetic holds.' },
    { subject: 'science', text: 'Honey does not spoil. Archaeologists have found edible honey in Egyptian tombs — it is too acidic and too low in water for bacteria to grow.' },
    { subject: 'science', text: 'Your body replaces about 330 billion cells a day, roughly 1% of you. Most are red blood cells and gut lining.' },
    { subject: 'science', text: 'Sound travels about 4.3 times faster in water than in air, which is why whale song carries for hundreds of kilometres.' },
    { subject: 'science', text: 'Bananas are slightly radioactive. They contain potassium-40, and the dose is so small it is used as an informal unit — the "banana equivalent dose".' },
    { subject: 'science', text: 'Hearing loss from noise happens because hair cells in the cochlea are destroyed, and in mammals they do not grow back. Birds and fish regenerate theirs.' },
    { subject: 'history', text: 'Oxford University was teaching before the Aztec Empire existed. Teaching there dates to 1096; Tenochtitlan was founded in 1325.' },
    { subject: 'history', text: 'Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid of Giza — about 2,500 years after it, and 2,000 years before Apollo 11.' },
    { subject: 'history', text: 'The shortest war on record lasted about 38 minutes: Britain and Zanzibar, 27 August 1896.' },
    { subject: 'history', text: 'The printing press did not invent movable type — Bi Sheng made ceramic movable type in China around 1040, four centuries before Gutenberg.' },
    { subject: 'ela', text: '"Set" has more distinct senses than almost any other English word — the Oxford English Dictionary gives it well over 400.' },
    { subject: 'ela', text: 'The word "nice" originally meant ignorant, from Latin nescius. It drifted through foolish, precise and finally pleasant.' },
    { subject: 'ela', text: 'English has no future tense in the grammatical sense. "Will go" is a modal verb plus an infinitive, not an inflected form the way Latin or French futures are.' },
    { subject: 'ela', text: 'Reading something once and re-reading it is one of the least effective ways to study. Testing yourself on it is one of the most — the effect is large and very well replicated.' },
  ];

  /**
   * A stable hash of a date string.
   *
   * The point is determinism: the same day always yields the same question, on every
   * device, with no state to store and no drift if the app is opened twice. FNV-1a is
   * used because it is four lines and spreads consecutive dates well — consecutive days
   * must not land on neighbouring indices, or the "daily" question would cycle in order.
   */
  function hashDate(dateKey) {
    let h = 2166136261;
    for (let i = 0; i < dateKey.length; i++) {
      h ^= dateKey.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  const D = {
    SUBJECTS,
    LEVELS,
    QUESTIONS,
    FACTS,
    hashDate,

    /** Every question at a level, or all of them when the level is unknown. */
    forLevel(level) {
      const hits = QUESTIONS.filter((q) => q.level === level);
      return hits.length ? hits : QUESTIONS;
    },

    /**
     * The question for a given day.
     * Deterministic, so it does not change when the app is reopened, and identical
     * across devices for the same person on the same date.
     */
    questionFor(dateKey, level) {
      const pool = D.forLevel(level);
      return pool[hashDate(dateKey) % pool.length];
    },

    /** The fact for a given day. Offset so it does not track the question's subject. */
    factFor(dateKey) {
      return FACTS[hashDate(dateKey + '#fact') % FACTS.length];
    },

    byId(id) {
      return QUESTIONS.find((q) => q.id === id) || null;
    },

    subjectLabel(value) {
      const hit = SUBJECTS.find((s) => s.value === value);
      return hit ? hit.label : value;
    },

    /**
     * Answer history: how many were right, and the current run of correct days.
     * @param {Array} answers records from the dailyAnswers store
     */
    stats(answers) {
      const list = (answers || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
      const correct = list.filter((a) => a.correct).length;

      let streak = 0;
      for (let i = list.length - 1; i >= 0; i--) {
        if (!list[i].correct) break;
        streak++;
      }
      return { answered: list.length, correct, streak };
    },
  };

  V.daily = D;
})(window.V);
