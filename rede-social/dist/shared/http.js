// Express não propaga rejeições de Promise para o error handler sozinho;
// este wrapper garante que qualquer erro lançado (ex.: UserNotFoundError)
// chegue ao errorHandler.ts em vez de derrubar o processo.
export function asyncHandler(handler) {
    return (req, res, next) => {
        handler(req, res).catch(next);
    };
}
