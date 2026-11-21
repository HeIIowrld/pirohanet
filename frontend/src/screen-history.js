import {useEffect, useRef, useState} from 'react';

export function useScreenHistory(onBackOrForward, initialView) {
  const [view, setView] = useState(initialView);
  const entries = useRef([view]);
  const position = useRef(0);
  const resetView = useRef(null);
  const listener = useRef(onBackOrForward);
  const [key] = useState(() => Math.random().toString(36).slice(2));
  listener.current = onBackOrForward;

  useEffect(() => {
    history.replaceState({...history.state, modo: key, position: 0}, '');
    function restore(event) {
      const target = event.state?.position;
      if (event.state?.modo !== key) return;
      if (!entries.current[target]) {
        history.go(-target);
        return;
      }
      const entry = entries.current[target];
      if (entry.screen === 'loading') {
        history.go(-1);
        return;
      }
      position.current = target;
      const next = resetView.current ?? entry;
      if (resetView.current) entries.current.splice(1);
      resetView.current = null;
      entries.current[target] = next;
      listener.current();
      setView(next);
    }
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [key]);

  function move(next, {replace = false} = {}) {
    if (replace) {
      entries.current[position.current] = next;
    } else {
      position.current += 1;
      history.pushState({modo: key, position: position.current}, '');
      entries.current.splice(position.current, Infinity, next);
    }
    setView(next);
  }

  function reset(next) {
    if (position.current === 0) {
      entries.current.splice(1);
      move(next, {replace: true});
      return;
    }
    resetView.current = next;
    history.go(-position.current);
  }

  return {
    view,
    previous: entries.current[position.current - 1],
    move,
    back: () => { if (position.current > 0) history.back(); },
    reset,
  };
}
