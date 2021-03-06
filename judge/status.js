const STATUS = {
    STATUS_ACCEPTED: 1,
    STATUS_WRONG_ANSWER: 2,
    STATUS_TIME_LIMIT_EXCEEDED: 3,
    STATUS_MEMORY_LIMIT_EXCEEDED: 4,
    STATUS_RUNTIME_ERROR: 6,
    STATUS_COMPILE_ERROR: 7,
    STATUS_SYSTEM_ERROR: 8,
    STATUS_JUDGING: 20,
    STATUS_COMPILING: 21,
    STATUS_IGNORED: 30,
};

const STATUS_TEXTS = {
    [STATUS.STATUS_WAITING]: 'Waiting',
    [STATUS.STATUS_ACCEPTED]: 'Accepted',
    [STATUS.STATUS_WRONG_ANSWER]: 'Wrong Answer',
    [STATUS.STATUS_TIME_LIMIT_EXCEEDED]: 'Time Exceeded',
    [STATUS.STATUS_MEMORY_LIMIT_EXCEEDED]: 'Memory Exceeded',
    [STATUS.STATUS_OUTPUT_LIMIT_EXCEEDED]: 'Output Exceeded',
    [STATUS.STATUS_RUNTIME_ERROR]: 'Runtime Error',
    [STATUS.STATUS_COMPILE_ERROR]: 'Compile Error',
    [STATUS.STATUS_SYSTEM_ERROR]: 'System Error',
    [STATUS.STATUS_CANCELED]: 'Cancelled',
    [STATUS.STATUS_ETC]: 'Unknown Error',
    [STATUS.STATUS_JUDGING]: 'Running',
    [STATUS.STATUS_COMPILING]: 'Compiling',
    [STATUS.STATUS_FETCHED]: 'Fetched',
    [STATUS.STATUS_IGNORED]: 'Ignored',
};

module.exports = { ...STATUS, STATUS_TEXTS };
