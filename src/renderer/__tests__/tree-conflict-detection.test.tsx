import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

import { parseSvnStatusXml } from '@main/svn/parsers';
import { TreeConflictDialog } from '../src/components/ui/TreeConflictDialog';

describe('tree conflict detection and display', () => {
  it('preserves tree conflict metadata from SVN status XML', () => {
    const status = parseSvnStatusXml(
      `<?xml version="1.0"?>
      <status>
        <target path="/repo">
          <entry path="/repo/src/renamed-file.ts">
            <wc-status item="conflicted">
              <tree-conflict operation="update" action="edit" reason="deleted" type="file" />
            </wc-status>
          </entry>
        </target>
      </status>`,
      '/repo'
    );

    expect(status.entries[0]).toMatchObject({
      path: '/repo/src/renamed-file.ts',
      status: 'C',
      treeConflict: {
        operation: 'update',
        action: 'edit',
        reason: 'deleted',
        type: 'file',
      },
    });
  });

  it('displays tree conflict details and returns the selected resolution', () => {
    const onResolve = vi.fn();
    const onClose = vi.fn();

    render(
      <TreeConflictDialog
        isOpen={true}
        onClose={onClose}
        conflictPath="/repo/src/renamed-file.ts"
        conflictDescription="Local delete conflicts with incoming edit."
        onResolve={onResolve}
      />
    );

    expect(screen.getByText('Tree Conflict')).toBeInTheDocument();
    expect(screen.getByText('renamed-file.ts')).toBeInTheDocument();
    expect(screen.getByText('Local delete conflicts with incoming edit.')).toBeInTheDocument();
    expect(screen.getByText('What is a tree conflict?')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Resolve conflict using mine'));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    expect(onResolve).toHaveBeenCalledWith('mine-conflict');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
