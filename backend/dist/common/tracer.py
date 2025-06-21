# codeviz-ai/backend/src/common/tracer.py
import sys
import io
import contextlib
import traceback
import json
import os

class CodeTracer:
    def __init__(self):
        self.trace_log = []

    def tracer_function(self, frame, event, arg):
        # Only trace user's code, not the tracer itself
        # The user's code will be mounted as 'user_code.py'
        if not frame.f_code.co_filename.endswith('user_code.py'):
            return self.tracer_function

        # Capture basic info for line, call, return events
        log_entry = {
            'event': event,
            'line_no': frame.f_lineno,
            'filename': os.path.basename(frame.f_code.co_filename),
        }

        if event == 'line':
            # Capture current global and local variables
            # Using repr() to safely represent values, avoiding issues with complex objects
            log_entry['globals'] = {k: repr(v) for k, v in frame.f_globals.items() if not k.startswith('__') and not k.startswith('sys') and not k.startswith('os')}
            log_entry['locals'] = {k: repr(v) for k, v in frame.f_locals.items() if not k.startswith('__') and not k.startswith('sys') and not k.startswith('os')}
        elif event == 'call':
            log_entry['function_name'] = frame.f_code.co_name
        elif event == 'return':
            log_entry['function_name'] = frame.f_code.co_name
            log_entry['return_value'] = repr(arg)

        self.trace_log.append(log_entry)
        return self.tracer_function # Continue tracing

    def get_trace(self):
        return self.trace_log

def main():
    # The user's code will be mounted at /mnt/user_code.py inside the container
    user_code_path = "/mnt/user_code.py"

    try:
        with open(user_code_path, 'r') as f:
            code_to_execute = f.read()
    except FileNotFoundError:
        print(json.dumps({"error": f"User code file not found at {user_code_path}"}))
        sys.exit(1)

    old_stdout = sys.stdout
    old_stderr = sys.stderr
    redirected_output = io.StringIO()
    redirected_error = io.StringIO()

    tracer = CodeTracer()
    execution_globals = {} # A fresh dictionary for the executed code's globals

    result = {
        "output": "",
        "error": None,
        "execution_trace": []
    }

    try:
        # Redirect stdout/stderr
        sys.stdout = redirected_output
        sys.stderr = redirected_error

        # Set the trace function
        sys.settrace(tracer.tracer_function)

        # Execute the code
        # WARNING: exec() is inherently dangerous for untrusted code.
        # This is for demonstration of trace capture only.
        exec(code_to_execute, execution_globals)

    except Exception as e:
        error_type = type(e).__name__
        error_message = str(e)
        detailed_traceback = traceback.format_exc()
        result["error"] = f"{error_type}: {error_message}\n{detailed_traceback}"
    finally:
        # Restore stdout/stderr
        sys.stdout = old_stdout
        sys.stderr = old_stderr
        # Disable tracing
        sys.settrace(None)

    result["output"] = redirected_output.getvalue()
    result["execution_trace"] = tracer.get_trace()

    print(json.dumps(result))

if __name__ == "__main__":
    main()
