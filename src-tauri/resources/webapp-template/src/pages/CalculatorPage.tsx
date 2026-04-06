import { useState } from 'react'
import { Link } from 'react-router-dom'

export function CalculatorPage() {
  const [expr, setExpr] = useState('')
  const [result, setResult] = useState<string | null>(null)

  const onCalculate = () => {
    const raw = expr.trim()
    if (!raw) {
      setResult(null)
      return
    }
    try {
      const value = Function(`"use strict"; return (${raw})`)() as unknown
      setResult(String(value))
    } catch {
      setResult('Invalid expression')
    }
  }

  return (
    <div className="flex min-h-full flex-col gap-6 p-6">
      <header className="border-app-border flex flex-wrap items-baseline justify-between gap-2 border-b pb-4">
        <div>
          <h1 className="text-app-text-1 text-xl font-semibold tracking-tight">
            Calculator
          </h1>
          <p className="text-app-text-3 mt-1 text-sm">
            Example sub-page at <code className="text-app-text-2">/calculator</code>
          </p>
        </div>
        <Link
          to="/"
          className="text-app-accent-600 hover:text-app-accent-500 text-sm font-medium"
        >
          ← My apps
        </Link>
      </header>
      <main className="border-app-border bg-app-bg-1 max-w-md space-y-4 rounded-xl border p-5 shadow-sm">
        <p className="text-app-text-2 text-sm">
          Type a math expression and press Calculate.
        </p>
        <div className="space-y-2">
          <label
            className="text-app-text-1 block text-sm font-medium"
            htmlFor="expr"
          >
            Expression
          </label>
          <input
            id="expr"
            type="text"
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            placeholder="e.g. 2 + 2"
            className="border-app-border bg-app-bg-0 text-app-text-1 placeholder:text-app-text-3 focus:ring-app-accent-500 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onCalculate}
            className="bg-app-accent-600 hover:bg-app-accent-500 rounded-lg px-4 py-2 text-sm font-medium text-white"
          >
            Calculate
          </button>
          <button
            type="button"
            onClick={() => {
              setExpr('')
              setResult(null)
            }}
            className="border-app-border text-app-text-2 hover:bg-app-bg-0 rounded-lg border px-4 py-2 text-sm"
          >
            Clear
          </button>
        </div>
        {result !== null ? (
          <p className="text-app-text-2 text-sm">
            <span className="text-app-text-1 font-medium">Result: </span>
            {result}
          </p>
        ) : null}
      </main>
    </div>
  )
}
