module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  moduleNameMapper: {
    '^@vpos/shared-types$': '<rootDir>/../../packages/shared-types/src',
    '^@vpos/offline-core$': '<rootDir>/../../packages/offline-core/src',
    '^@vpos/printing-core$': '<rootDir>/../../packages/printing-core/src'
  }
};
