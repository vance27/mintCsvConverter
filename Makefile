.PHONY: test run

test:
	python3 -m unittest discover -s tests -t .

run:
	python3 main.py $(FILE) EXPENSE_SPLITTING $(NAME)
