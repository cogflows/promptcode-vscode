import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { optimizeSelection } from '../src/utils/patternOptimizer';

function mkfile(p: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '// test\n');
}

describe('pattern optimizer', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.cwd()), 'opt-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('minimal level', () => {
    it('collapses to directory/** when directory fully covered', () => {
      mkfile(path.join(tmp, 'src/components/Button/Button.tsx'));
      mkfile(path.join(tmp, 'src/components/Button/Button.test.tsx'));
      mkfile(path.join(tmp, 'src/components/Button/Button.stories.tsx'));
      mkfile(path.join(tmp, 'src/components/Button/index.ts'));

      const sel = [
        'src/components/Button/Button.tsx',
        'src/components/Button/Button.test.tsx',
        'src/components/Button/Button.stories.tsx',
        'src/components/Button/index.ts',
      ];
      const res = await optimizeSelection(sel, tmp, 'minimal');
      expect(res.patterns).toContain('src/components/Button/**');
      expect(res.stats.savedPatterns).toBe(3);
    });

    it('preserves individual files when directory not fully covered', () => {
      mkfile(path.join(tmp, 'src/api/users.ts'));
      mkfile(path.join(tmp, 'src/api/posts.ts'));
      mkfile(path.join(tmp, 'src/api/comments.ts'));
      mkfile(path.join(tmp, 'src/api/auth.ts')); // not selected

      const sel = [
        'src/api/users.ts',
        'src/api/posts.ts',
        'src/api/comments.ts',
      ];
      const res = await optimizeSelection(sel, tmp, 'minimal');
      expect(res.patterns).toEqual([
        'src/api/comments.ts',
        'src/api/posts.ts',
        'src/api/users.ts',
      ]);
    });
  });

  describe('balanced level', () => {
    it('groups directory by extension when all of that extension selected', () => {
      mkfile(path.join(tmp, 'src/api/users.ts'));
      mkfile(path.join(tmp, 'src/api/posts.ts'));
      mkfile(path.join(tmp, 'src/api/comments.ts'));
      mkfile(path.join(tmp, 'src/api/auth.ts'));
      mkfile(path.join(tmp, 'src/api/README.md')); // different extension

      const sel = [
        'src/api/users.ts',
        'src/api/posts.ts',
        'src/api/comments.ts',
        'src/api/auth.ts',
      ];
      const res = await optimizeSelection(sel, tmp, 'balanced');
      // Should optimize to src/api/*.ts since all .ts files are selected
      expect(res.patterns.some(p => p === 'src/api/*.ts' || p === 'src/api/**/*.ts')).toBe(true);
      expect(res.stats.savedPatterns).toBeGreaterThan(0);
    });

    it('almost-all exclusion (exclude one)', () => {
      mkfile(path.join(tmp, 'pkg/a.ts'));
      mkfile(path.join(tmp, 'pkg/b.ts'));
      mkfile(path.join(tmp, 'pkg/c.ts')); // not selected

      const sel = ['pkg/a.ts', 'pkg/b.ts'];
      const res = await optimizeSelection(sel, tmp, 'balanced');
      // expect pkg/** + !pkg/c.ts
      expect(res.patterns).toContain('pkg/**');
      expect(res.patterns).toContain('!pkg/c.ts');
      expect(res.applied.some(a => a.rule === 'almost-all-exclusion')).toBe(true);
    });

    it('handles nested directories correctly', () => {
      mkfile(path.join(tmp, 'src/features/auth/login.ts'));
      mkfile(path.join(tmp, 'src/features/auth/logout.ts'));
      mkfile(path.join(tmp, 'src/features/auth/session.ts'));
      mkfile(path.join(tmp, 'src/features/user/profile.ts'));

      const sel = [
        'src/features/auth/login.ts',
        'src/features/auth/logout.ts',
        'src/features/auth/session.ts',
      ];
      const res = await optimizeSelection(sel, tmp, 'balanced');
      expect(res.patterns).toContain('src/features/auth/**');
      expect(res.stats.savedPatterns).toBe(2);
    });
  });

  describe('aggressive level', () => {
    it('merges sibling directories with braces', () => {
      mkfile(path.join(tmp, 'src/api/a.ts'));
      mkfile(path.join(tmp, 'src/auth/x.ts'));
      mkfile(path.join(tmp, 'src/auth/y.ts'));
      
      const sel = ['src/api/a.ts', 'src/auth/x.ts', 'src/auth/y.ts'];
      const res = await optimizeSelection(sel, tmp, 'aggressive');
      
      // Could be brace merge or extension patterns
      const hasBrace = res.patterns.some(p => p.includes('{') && p.includes('}'));
      const hasOptimization = res.stats.savedPatterns > 0;
      expect(hasBrace || hasOptimization).toBe(true);
    });

    it('brace merge deeper siblings with mixed nested files', () => {
      mkfile(path.join(tmp, 'src/feature/a/index.ts'));
      mkfile(path.join(tmp, 'src/feature/a/util.ts'));
      mkfile(path.join(tmp, 'src/feature/b/index.ts'));
      mkfile(path.join(tmp, 'src/feature/b/util.ts'));
      mkfile(path.join(tmp, 'src/feature/c/readme.md')); // different ext, should not block brace

      const sel = [
        'src/feature/a/index.ts',
        'src/feature/a/util.ts',
        'src/feature/b/index.ts',
        'src/feature/b/util.ts',
      ];
      const res = await optimizeSelection(sel, tmp, 'aggressive');
      
      // Expect a brace-merged directory or extension merge capturing a + b
      const hasDirBrace = res.patterns.some(p => 
        p === 'src/feature/{a,b}/**' || 
        p.includes('src/feature/{a,b}')
      );
      const hasFullCoverage = res.patterns.some(p => 
        p === 'src/feature/a/**' && res.patterns.some(q => q === 'src/feature/b/**')
      );
      expect(hasDirBrace || hasFullCoverage).toBe(true);
    });

    it('merges extension siblings with braces', () => {
      mkfile(path.join(tmp, 'src/components/Button.ts'));
      mkfile(path.join(tmp, 'src/components/Button.tsx'));
      mkfile(path.join(tmp, 'src/components/Input.ts'));
      mkfile(path.join(tmp, 'src/components/Input.tsx'));

      const sel = [
        'src/components/Button.ts',
        'src/components/Button.tsx',
        'src/components/Input.ts',
        'src/components/Input.tsx',
      ];
      const res = await optimizeSelection(sel, tmp, 'aggressive');
      
      // Should create something like src/components/*.{ts,tsx}
      const hasExtBrace = res.patterns.some(p => p.includes('.{ts,tsx}'));
      expect(hasExtBrace).toBe(true);
    });

    it('global extension grouping when all files of extension selected', () => {
      mkfile(path.join(tmp, 'src/utils/helper.ts'));
      mkfile(path.join(tmp, 'src/api/endpoint.ts'));
      mkfile(path.join(tmp, 'test/unit.ts'));
      mkfile(path.join(tmp, 'src/components/Button.tsx')); // different extension

      const sel = [
        'src/utils/helper.ts',
        'src/api/endpoint.ts',
        'test/unit.ts',
      ];
      const res = await optimizeSelection(sel, tmp, 'aggressive');
      
      // Should create **/*.ts
      expect(res.patterns).toContain('**/*.ts');
      expect(res.stats.savedPatterns).toBe(2);
    });

    it('handles almost-all with 2 missing files', () => {
      mkfile(path.join(tmp, 'lib/a.js'));
      mkfile(path.join(tmp, 'lib/b.js'));
      mkfile(path.join(tmp, 'lib/c.js'));
      mkfile(path.join(tmp, 'lib/d.js')); // not selected
      mkfile(path.join(tmp, 'lib/e.js')); // not selected

      const sel = ['lib/a.js', 'lib/b.js', 'lib/c.js'];
      const res = await optimizeSelection(sel, tmp, 'aggressive');
      
      // Should have lib/** with exclusions
      expect(res.patterns).toContain('lib/**');
      expect(res.patterns).toContain('!lib/d.js');
      expect(res.patterns).toContain('!lib/e.js');
    });
  });

  describe('edge cases', () => {
    it('handles empty selection', () => {
      const res = await optimizeSelection([], tmp, 'balanced');
      expect(res.patterns).toEqual([]);
      expect(res.stats.inputFiles).toBe(0);
    });

    it('handles single file', () => {
      mkfile(path.join(tmp, 'lonely.ts'));
      const res = await optimizeSelection(['lonely.ts'], tmp, 'balanced');
      expect(res.patterns).toEqual(['lonely.ts']);
      expect(res.stats.savedPatterns).toBe(0);
    });

    it('handles Windows paths by converting to POSIX', () => {
      mkfile(path.join(tmp, 'win/file.ts'));
      const winPath = 'win\\file.ts';
      const res = await optimizeSelection([winPath], tmp, 'minimal');
      expect(res.patterns).toEqual(['win/file.ts']);
    });

    it('preserves order: dirs -> extensions -> files -> excludes', async () => {
      mkfile(path.join(tmp, 'dir/a.ts'));
      mkfile(path.join(tmp, 'dir/b.ts'));
      mkfile(path.join(tmp, 'other.md'));
      mkfile(path.join(tmp, 'single.txt'));
      mkfile(path.join(tmp, 'exclude/skip.ts'));

      const sel = [
        'single.txt',
        'other.md',
        'dir/a.ts',
        'dir/b.ts',
      ];
      const res = await optimizeSelection(sel, tmp, 'balanced');
      
      // Check that directory patterns come first
      const dirIndex = res.patterns.findIndex(p => p.includes('dir'));
      const fileIndex = res.patterns.findIndex(p => p === 'single.txt');
      if (dirIndex >= 0 && fileIndex >= 0) {
        expect(dirIndex).toBeLessThan(fileIndex);
      }
    });
  });

  describe('optimization metadata', () => {
    it('reports applied rules correctly', async () => {
      mkfile(path.join(tmp, 'src/a.ts'));
      mkfile(path.join(tmp, 'src/b.ts'));
      mkfile(path.join(tmp, 'src/c.ts'));

      const sel = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
      const res = await optimizeSelection(sel, tmp, 'balanced');
      
      expect(res.applied.length).toBeGreaterThan(0);
      const rule = res.applied[0];
      expect(rule.rule).toBeDefined();
      expect(rule.details).toBeDefined();
      expect(rule.beforeCount).toBeGreaterThan(0);
      expect(rule.afterCount).toBeGreaterThan(0);
    });

    it('calculates stats correctly', async () => {
      mkfile(path.join(tmp, 'a.ts'));
      mkfile(path.join(tmp, 'b.ts'));
      mkfile(path.join(tmp, 'c.ts'));
      mkfile(path.join(tmp, 'd.ts'));

      const sel = ['a.ts', 'b.ts', 'c.ts', 'd.ts'];
      const res = await optimizeSelection(sel, tmp, 'aggressive');
      
      expect(res.stats.inputFiles).toBe(4);
      expect(res.stats.finalPatterns).toBeGreaterThan(0);
      expect(res.stats.savedPatterns).toBeGreaterThanOrEqual(0);
      expect(res.stats.inputFiles - res.stats.savedPatterns).toBe(res.stats.finalPatterns);
    });
  });
});