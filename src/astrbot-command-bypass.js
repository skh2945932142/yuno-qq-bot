function getFilterName(filter = {}) {
  if (typeof filter === 'string') {
    return filter;
  }

  return String(
    filter.type
      || filter.name
      || filter.filterName
      || filter.className
      || filter.constructor?.name
      || ''
  );
}

function getHandlerFilters(handler = {}) {
  const filters = handler.eventFilters || handler.event_filters || handler.filters || [];
  return Array.isArray(filters) ? filters : [];
}

export function shouldBypassAstrBotCommand(context = {}) {
  const handlers = context.activatedHandlers
    || context.metadata?.activatedHandlers
    || context.astrbot?.activatedHandlers
    || [];

  if (!Array.isArray(handlers)) {
    return false;
  }

  return handlers.some((handler) => getHandlerFilters(handler).some((eventFilter) => {
    const filterName = getFilterName(eventFilter);
    return filterName === 'CommandFilter' || filterName === 'CommandGroupFilter';
  }));
}
