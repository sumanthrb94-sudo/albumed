/* The studio -> customer handover. The photos and the database need a browser,
   but the addressing rules do not, and the addressing is where the mistakes
   that matter live: a take reaching the wrong number, or a family seeing the
   studio's own working copy. */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { addressedTo, notYetOpened, sentByStudio, splitRecipients } from '../src/lib/studio'
import { readPlan, writePlan } from '../src/lib/plan'
import type { Delivery } from '../src/lib/types'

const delivery = (over: Partial<Delivery> = {}): Delivery => ({
  id: 'dlv_1',
  toPhones: ['9876543210'],
  studioName: 'Raju Photo Studio',
  studioPhone: '9000011122',
  message: '',
  sentAt: 1,
  openedBy: {},
  event: {
    title: 'Maa Pelli',
    hosts: 'Sireesha & Karthik',
    eventDate: '14 February 2026',
    venue: 'Rajahmundry',
    occasionNote: '',
    language: 'telugu',
    themeId: 'godavari',
  },
  photos: [],
  ...over,
})

test('a typed-in list is sorted into numbers we can send to and ones we cannot', () => {
  const { accepted, rejected } = splitRecipients([
    '98765 43210', // spaces
    '+91 91234 56789', // country code
    '09123456789', // trunk zero, same number as above
    '1234567890', // landline shaped
    '98765', // half typed
    '   ', // the spare empty row people leave open
  ])
  assert.deepEqual(accepted, ['9876543210', '9123456789'])
  assert.deepEqual(rejected, ['1234567890', '98765'])
})

test('the same number typed twice is only sent to once', () => {
  const { accepted } = splitRecipients(['9876543210', '+919876543210', '0 98765 43210'])
  assert.deepEqual(accepted, ['9876543210'])
})

test('a take only reaches the numbers it was addressed to', () => {
  const all = [delivery({ id: 'a', toPhones: ['9876543210', '9812345678'] }), delivery({ id: 'b', toPhones: ['9999988888'] })]
  assert.deepEqual(addressedTo(all, '9876543210').map((d) => d.id), ['a'])
  assert.deepEqual(addressedTo(all, '9812345678').map((d) => d.id), ['a'], 'the second recipient sees it too')
  assert.deepEqual(addressedTo(all, '9999988888').map((d) => d.id), ['b'])
  assert.deepEqual(addressedTo(all, '9000000000').map((d) => d.id), [], 'a stranger sees nothing')
})

test('the inbox is addressed by number however it was typed', () => {
  const all = [delivery({ toPhones: ['9876543210'] })]
  for (const typed of ['9876543210', '+91 98765 43210', '098765 43210', '91-98765-43210']) {
    assert.equal(addressedTo(all, typed).length, 1, `${typed} did not resolve`)
  }
})

test('opening a delivery clears it from that number, not from the other recipient', () => {
  const all = [delivery({ toPhones: ['9876543210', '9812345678'], openedBy: { '9876543210': 'prj_1' } })]
  assert.equal(notYetOpened(all, '9876543210').length, 0, 'it should not still be waiting for whoever opened it')
  assert.equal(notYetOpened(all, '9812345678').length, 1, 'the other recipient still has it waiting')
})

test('a studio sees what it sent, and nobody else does', () => {
  const all = [delivery({ id: 'mine', studioPhone: '9000011122' }), delivery({ id: 'theirs', studioPhone: '9000099999' })]
  assert.deepEqual(sentByStudio(all, '+91 90000 11122').map((d) => d.id), ['mine'])
  assert.deepEqual(sentByStudio(all, '9000099999').map((d) => d.id), ['theirs'])
  // The family is not a studio, so its number has sent nothing.
  assert.deepEqual(sentByStudio(all, '9876543210'), [])
})

test('inboxes are newest first', () => {
  const all = [delivery({ id: 'old', sentAt: 1 }), delivery({ id: 'new', sentAt: 9 }), delivery({ id: 'mid', sentAt: 5 })]
  assert.deepEqual(addressedTo(all, '9876543210').map((d) => d.id), ['new', 'mid', 'old'])
})

/* A studio and the family it sent to share one device in this demo. */

test('a plan belongs to a number, not to the browser', () => {
  const store = new Map<string, string>()
  const g = globalThis as { localStorage?: Storage }
  const before = g.localStorage
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as unknown as Storage
  try {
    writePlan('studio', '9000011122')
    assert.equal(readPlan('9000011122'), 'studio', 'the studio kept its plan')
    assert.equal(readPlan('9876543210'), 'free', 'the family must not inherit the studio subscription')
    writePlan('plus', '9876543210')
    assert.equal(readPlan('9000011122'), 'studio', 'and the studio must not inherit theirs')
  } finally {
    g.localStorage = before
  }
})
