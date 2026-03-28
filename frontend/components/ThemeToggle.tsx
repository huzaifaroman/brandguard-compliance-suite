"use client";

import { useState, useEffect } from "react";
import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const root = document.documentElement;
    setDark(root.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const root = document.documentElement;
    if (dark) {
      root.classList.remove("dark");
    } else {
      root.classList.add("dark");
    }
    setDark(!dark);
  };

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-200 text-left"
    >
      {dark ? (
        <Sun className="w-[18px] h-[18px]" />
      ) : (
        <Moon className="w-[18px] h-[18px]" />
      )}
      <div className="flex flex-col">
        <span className="text-[13px] font-medium leading-tight">
          {dark ? "Light Mode" : "Dark Mode"}
        </span>
        <span className="text-[10px] text-muted-foreground leading-tight">
          Toggle appearance
        </span>
      </div>
    </button>
  );
}
