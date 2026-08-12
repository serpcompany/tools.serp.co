import assert from 'node:assert/strict';
import test from 'node:test';

import { createBrowserDeliveryStore } from './browser-workflow-lifecycle.ts';

function media(name: string) {
  return {
    name,
    format: 'txt',
    mimeType: 'text/plain',
    bytes: new TextEncoder().encode(name),
  };
}

test('delivery store owns stable URLs, download names, replacement, and explicit release', async () => {
  const originalDocument = globalThis.document;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const created: string[] = [];
  const revoked: string[] = [];
  const clicked: Array<{ href: string; download: string }> = [];
  let nextUrl = 0;
  URL.createObjectURL = () => {
    const url = `blob:store-${++nextUrl}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url) => revoked.push(url);
  globalThis.document = {
    createElement() {
      const anchor = {
        href: '',
        download: '',
        click() {
          clicked.push({ href: anchor.href, download: anchor.download });
        },
      };
      return anchor;
    },
  } as unknown as Document;

  try {
    const store = createBrowserDeliveryStore({ idPrefix: 'test' });
    const firstId = await store.deliver(media('first.txt'));
    assert.equal(store.objectUrl(firstId), 'blob:store-1');
    assert.equal(store.objectUrl(firstId), 'blob:store-1');
    store.download({
      deliveryId: firstId,
      name: 'renamed.txt',
      format: 'txt',
      mimeType: 'text/plain',
      size: 9,
    });
    assert.deepEqual(clicked, [
      { href: 'blob:store-1', download: 'renamed.txt' },
    ]);
    assert.deepEqual(created, ['blob:store-1']);

    const secondId = await store.deliver(media('second.txt'));
    assert.equal(store.get(firstId), undefined);
    assert.deepEqual(revoked, ['blob:store-1']);
    assert.equal(store.objectUrl(secondId), 'blob:store-2');
    store.release(secondId);
    assert.deepEqual(revoked, ['blob:store-1', 'blob:store-2']);
  } finally {
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test('delivery store releases a result when starting its download throws', async () => {
  const originalDocument = globalThis.document;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  URL.createObjectURL = () => 'blob:failed-store';
  URL.revokeObjectURL = (url) => revoked.push(url);
  globalThis.document = {
    createElement() {
      return {
        href: '',
        download: '',
        click() {
          throw new Error('anchor click failed');
        },
      };
    },
  } as unknown as Document;

  try {
    const store = createBrowserDeliveryStore({ idPrefix: 'test' });
    const deliveryId = await store.deliver(media('result.txt'));
    assert.throws(
      () =>
        store.download({
          deliveryId,
          name: 'result.txt',
          format: 'txt',
          mimeType: 'text/plain',
          size: 10,
        }),
      /anchor click failed/,
    );
    assert.equal(store.get(deliveryId), undefined);
    assert.deepEqual(revoked, ['blob:failed-store']);
  } finally {
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});
