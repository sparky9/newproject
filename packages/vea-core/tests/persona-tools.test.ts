/**
 * Test: Persona Tool Registry
 *
 * Validates:
 * - Tool access control per persona
 * - Tool definitions are correct
 * - Module mappings are accurate
 */

import {
  getPersonaTools,
  canPersonaAccessTool,
  getPersonaModules,
  getAllTools,
  getToolDefinition,
} from '../src/persona-tools';

describe('Persona Tool Registry', () => {
  describe('getPersonaTools', () => {
    test('CEO should have access to all tools', () => {
      const ceoTools = getPersonaTools('ceo');

      expect(ceoTools.length).toBeGreaterThan(10);
      expect(ceoTools.some(t => t.tool === 'vpa_prospects')).toBe(true);
      expect(ceoTools.some(t => t.tool === 'vpa_pipeline')).toBe(true);
      expect(ceoTools.some(t => t.tool === 'vpa_email')).toBe(true);
    });

    test('CFO should have financial tools only', () => {
      const cfoTools = getPersonaTools('cfo');

      expect(cfoTools.some(t => t.tool === 'vpa_bookkeeping')).toBe(true);
      expect(cfoTools.some(t => t.tool === 'vpa_time_billing')).toBe(true);
      expect(cfoTools.some(t => t.tool === 'vpa_pipeline')).toBe(true); // For revenue metrics

      // Should NOT have marketing tools
      expect(cfoTools.some(t => t.tool === 'vpa_email')).toBe(false);
      expect(cfoTools.some(t => t.tool === 'vpa_content')).toBe(false);
    });

    test('CMO should have marketing tools only', () => {
      const cmoTools = getPersonaTools('cmo');

      expect(cmoTools.some(t => t.tool === 'vpa_prospects')).toBe(true);
      expect(cmoTools.some(t => t.tool === 'vpa_email')).toBe(true);
      expect(cmoTools.some(t => t.tool === 'vpa_content')).toBe(true);
      expect(cmoTools.some(t => t.tool === 'vpa_social')).toBe(true);

      // Should NOT have financial tools
      expect(cmoTools.some(t => t.tool === 'vpa_bookkeeping')).toBe(false);
    });

    test('CTO should have technical tools only', () => {
      const ctoTools = getPersonaTools('cto');

      expect(ctoTools.some(t => t.tool === 'vpa_tasks')).toBe(true);
      expect(ctoTools.some(t => t.tool === 'vpa_research')).toBe(true);

      // Should NOT have marketing or financial tools
      expect(ctoTools.some(t => t.tool === 'vpa_email')).toBe(false);
      expect(ctoTools.some(t => t.tool === 'vpa_bookkeeping')).toBe(false);
    });
  });

  describe('canPersonaAccessTool', () => {
    test('CEO can access all tools', () => {
      expect(canPersonaAccessTool('ceo', 'vpa_prospects')).toBe(true);
      expect(canPersonaAccessTool('ceo', 'vpa_bookkeeping')).toBe(true);
      expect(canPersonaAccessTool('ceo', 'vpa_email')).toBe(true);
      expect(canPersonaAccessTool('ceo', 'vpa_tasks')).toBe(true);
    });

    test('CFO cannot access marketing tools', () => {
      expect(canPersonaAccessTool('cfo', 'vpa_bookkeeping')).toBe(true);
      expect(canPersonaAccessTool('cfo', 'vpa_email')).toBe(false);
      expect(canPersonaAccessTool('cfo', 'vpa_content')).toBe(false);
    });

    test('CMO cannot access financial tools', () => {
      expect(canPersonaAccessTool('cmo', 'vpa_prospects')).toBe(true);
      expect(canPersonaAccessTool('cmo', 'vpa_email')).toBe(true);
      expect(canPersonaAccessTool('cmo', 'vpa_bookkeeping')).toBe(false);
    });

    test('CTO has limited access', () => {
      expect(canPersonaAccessTool('cto', 'vpa_tasks')).toBe(true);
      expect(canPersonaAccessTool('cto', 'vpa_research')).toBe(true);
      expect(canPersonaAccessTool('cto', 'vpa_email')).toBe(false);
      expect(canPersonaAccessTool('cto', 'vpa_bookkeeping')).toBe(false);
    });
  });

  describe('getAllTools', () => {
    test('should return all available tools', () => {
      const allTools = getAllTools();

      expect(allTools.length).toBeGreaterThan(20);
      expect(allTools.every(t => t.tool && t.name && t.description)).toBe(true);
    });
  });

  describe('getToolDefinition', () => {
    test('should return correct tool definition', () => {
      const prospectsTool = getToolDefinition('vpa_prospects');

      expect(prospectsTool).toBeDefined();
      expect(prospectsTool?.name).toBe('Prospect Finder');
      expect(prospectsTool?.actions).toContain('search');
      expect(prospectsTool?.modules).toContain('prospect-finder');
    });

    test('should return undefined for unknown tool', () => {
      const unknownTool = getToolDefinition('vpa_unknown' as any);

      expect(unknownTool).toBeUndefined();
    });
  });
});

console.log('✅ All Persona Tool Registry tests defined');
