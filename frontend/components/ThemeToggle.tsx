"use client";

import { useState, useEffect } from "react";
import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light") {
      document.documentElement.classList.remove("dark");
      setDark(false);
    } else if (saved === "dark") {
      document.documentElement.classList.add("dark");
      setDark(true);
    } else {
      setDark(document.documentElement.classList.contains("dark"));
    }
  }, []);

  const toggle = () => {
    const root = document.documentElement;
    const next = !dark;
    if (next) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
    setDark(next);
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
