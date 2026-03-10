const mockSvnInfo = ({}(global as any).window = {
  api: {
    svn: {
      info: mockSvnInfo,
    },
  },
});

console.log('useWorkingCopyContext test setup complete');
