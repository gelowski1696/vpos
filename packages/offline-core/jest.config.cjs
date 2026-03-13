module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  moduleNameMapper: {
    '^@vpos/shared-types$': '<rootDir>/../shared-types/src'
  }
};
