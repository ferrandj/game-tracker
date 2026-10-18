import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, imgUrl } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('sends writes with the client header and JSON, reads without', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ game: { id: 'x' } }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await api.patch('abc', { rating: 7 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('api/games/abc');
    expect(init.method).toBe('PATCH');
    expect(init.headers).toMatchObject({ 'X-Tracker-Client': '1', 'Content-Type': 'application/json' });
    expect(init.body).toBe('{"rating":7}');
    await api.games();
    expect((f.mock.calls[1] as unknown as [string, RequestInit])[1].headers).toBeUndefined();
  });

  it('turns server errors and network failures into readable ApiErrors', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'rating must be 1..10 or null' }), { status: 400 }));
    await expect(api.patch('a', { rating: 99 })).rejects.toMatchObject({ status: 400, message: 'rating must be 1..10 or null' });
    vi.stubGlobal('fetch', async () => new Response('<html>', { status: 502 }));
    await expect(api.games()).rejects.toMatchObject({ status: 502, message: 'Erreur 502' });
    vi.stubGlobal('fetch', async () => { throw new TypeError('failed'); });
    await expect(api.games()).rejects.toBeInstanceOf(ApiError);
    await expect(api.games()).rejects.toMatchObject({ status: 0 });
  });

  it('encodes ids and queries', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    await api.tick('g1', 's:premier pas/1', true);
    await api.search('zelda & link');
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('api/games/g1/achievements/s%3Apremier%20pas%2F1');
    expect((f.mock.calls[1] as unknown as [string])[0]).toBe('api/search?q=zelda%20%26%20link');
  });

  it('serves pictures through the server', () => {
    expect(imgUrl(null)).toBe('');
    expect(imgUrl('https://images.igdb.com/a b.jpg')).toBe('api/img?u=https%3A%2F%2Fimages.igdb.com%2Fa%20b.jpg');
  });
});
