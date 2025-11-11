import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { videoProductionInternals } from '../video-production.js';

describe('video production helpers', () => {
  describe('getErrorMessage', () => {
    it('returns message for Error instances', () => {
      const message = videoProductionInternals.getErrorMessage(new Error('boom'));
      expect(message).toBe('boom');
    });

    it('passes through string values', () => {
      const message = videoProductionInternals.getErrorMessage('failure');
      expect(message).toBe('failure');
    });

    it('falls back to generic label for unknown types', () => {
      const message = videoProductionInternals.getErrorMessage({});
      expect(message).toBe('Unknown error');
    });
  });

  describe('parseCaptionWords', () => {
    it('converts well-formed entries and skips invalid ones', () => {
      const payload: Prisma.JsonValue = [
        { text: 'Hello', start: 0, end: 500 },
        { text: 'World', start: 500, end: 900 },
        { text: 123, start: 900, end: 1200 },
      ];

      const words = videoProductionInternals.parseCaptionWords(payload);
      expect(words).toEqual([
        { text: 'Hello', start: 0, end: 500 },
        { text: 'World', start: 500, end: 900 },
      ]);
    });

    it('returns empty array when payload is not an array', () => {
      expect(videoProductionInternals.parseCaptionWords(null)).toEqual([]);
      expect(videoProductionInternals.parseCaptionWords('nope' as unknown as Prisma.JsonValue)).toEqual(
        []
      );
    });
  });

  describe('parseViralMoments', () => {
    it('normalises array payloads and filters missing fields', () => {
      const payload: Prisma.JsonValue = [
        {
          title: 'Clip 1',
          description: 'Great moment',
          start: 1000,
          end: 4000,
          score: 0.9,
          keywords: ['growth', 42],
          sentiment: 'positive',
        },
        {
          title: 'Incomplete',
          description: 'Missing metrics',
        },
      ];

      const result = videoProductionInternals.parseViralMoments(payload);
      expect(result).toEqual([
        {
          title: 'Clip 1',
          description: 'Great moment',
          start: 1000,
          end: 4000,
          score: 0.9,
          keywords: ['growth'],
          sentiment: 'positive',
        },
      ]);
    });

    it('returns null when payload is empty or not array', () => {
      expect(videoProductionInternals.parseViralMoments(null)).toBeNull();
      expect(
        videoProductionInternals.parseViralMoments('invalid' as unknown as Prisma.JsonValue)
      ).toBeNull();
      expect(
        videoProductionInternals.parseViralMoments([] as unknown as Prisma.JsonValue)
      ).toBeNull();
    });
  });

  describe('extractComposition', () => {
    it('extracts composition objects when present', () => {
      const value: Prisma.JsonValue = {
        composition: { timeline: { tracks: [] } },
      };

      expect(videoProductionInternals.extractComposition(value)).toEqual({
        timeline: { tracks: [] },
      });
    });

    it('returns null when metadata is missing or malformed', () => {
      expect(videoProductionInternals.extractComposition(null)).toBeNull();
      expect(videoProductionInternals.extractComposition({})).toBeNull();
      expect(videoProductionInternals.extractComposition('nope' as unknown as Prisma.JsonValue)).toBeNull();
    });
  });

  describe('parseOutputUrls', () => {
    it('returns string arrays when present', () => {
      const urls = videoProductionInternals.parseOutputUrls(
        ['https://example.com/video.mp4'] as unknown as Prisma.JsonValue
      );
      expect(urls).toEqual(['https://example.com/video.mp4']);
    });

    it('ignores non-string entries and empty arrays', () => {
      expect(
        videoProductionInternals.parseOutputUrls(['https://valid', 42] as unknown as Prisma.JsonValue)
      ).toEqual(['https://valid']);
  expect(videoProductionInternals.parseOutputUrls([] as unknown as Prisma.JsonValue)).toBeUndefined();
      expect(videoProductionInternals.parseOutputUrls(null)).toBeUndefined();
    });
  });
});
